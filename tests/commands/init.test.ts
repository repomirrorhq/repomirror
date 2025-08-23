import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import {
  createTempDir,
  cleanupTempDir,
  mockConsole,
  mockProcess,
  createMockGitRepo,
} from "../helpers/test-utils";
import {
  mockInquirerResponses,
  mockTransformationPrompt,
} from "../helpers/fixtures";

// Mock external dependencies at module level
const mockInquirerPrompt = vi.fn();
const mockOra = vi.fn();
const mockExeca = vi.fn();
const mockClaudeQuery = vi.fn();

vi.mock("inquirer", () => ({
  default: {
    prompt: mockInquirerPrompt,
  },
}));

vi.mock("ora", () => ({
  default: mockOra,
}));

vi.mock("execa", () => ({
  execa: mockExeca,
}));

vi.mock("@anthropic-ai/claude-code", () => ({
  query: mockClaudeQuery,
}));

// Import the module after mocking
const { init } = await import("../../src/commands/init");

describe("init command", () => {
  let tempSourceDir: string;
  let tempTargetDir: string;
  let consoleMock: ReturnType<typeof mockConsole>;
  let processMock: ReturnType<typeof mockProcess>;
  let spinnerMock: any;

  beforeEach(async () => {
    // Create temporary directories
    tempSourceDir = await createTempDir("repomirror-source-");
    tempTargetDir = await createTempDir("repomirror-target-");

    // Setup mocks
    consoleMock = mockConsole();
    processMock = mockProcess(true); // Throw on process.exit by default

    // Mock process.cwd to return our temp source directory
    processMock.cwd.mockReturnValue(tempSourceDir);

    // Setup spinner mock
    spinnerMock = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
    };
    mockOra.mockReturnValue(spinnerMock);
    
    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup temp directories
    await cleanupTempDir(tempSourceDir);
    await cleanupTempDir(tempTargetDir);

    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("successful initialization flow", () => {
    it("should complete full initialization with all checks passing", async () => {
      // Setup target directory as git repo with remotes
      await createMockGitRepo(tempTargetDir, true);

      // Mock inquirer responses
      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });

      // Mock execa with successful responses
      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      // Mock Claude SDK query
      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
      });

      // Run init
      await init();

      // Verify inquirer was called
      expect(mockInquirerPrompt).toHaveBeenCalledWith([
        expect.objectContaining({
          type: "input",
          name: "sourceRepo",
          message: "Source Repo you want to transform:",
          default: "./"
        }),
        expect.objectContaining({
          type: "input", 
          name: "targetRepo",
          message: "Where do you want to transform code to:",
          default: expect.stringMatching(/-transformed$/)
        }),
        expect.objectContaining({
          type: "input",
          name: "transformationInstructions",
          message: "What changes do you want to make:",
          default: "translate this python repo to typescript"
        })
      ]);

      // Verify preflight checks were called
      expect(mockExeca).toHaveBeenCalledWith("git", ["rev-parse", "--git-dir"], { cwd: tempTargetDir });
      expect(mockExeca).toHaveBeenCalledWith("git", ["remote", "-v"], { cwd: tempTargetDir });
      expect(mockExeca).toHaveBeenCalledWith("claude", ["-p", "say hi"]);

      // Verify Claude query was called
      expect(mockClaudeQuery).toHaveBeenCalledWith({
        prompt: expect.stringContaining("your task is to generate an optimized prompt"),
      });

      // Verify .repomirror directory and files were created
      const repoMirrorDir = join(tempSourceDir, ".repomirror");
      const stats = await fs.stat(repoMirrorDir);
      expect(stats.isDirectory()).toBe(true);

      // Check prompt.md
      const promptContent = await fs.readFile(join(repoMirrorDir, "prompt.md"), "utf8");
      expect(promptContent).toBe(mockTransformationPrompt);

      // Check sync.sh
      const syncContent = await fs.readFile(join(repoMirrorDir, "sync.sh"), "utf8");
      expect(syncContent).toContain("claude -p --output-format=stream-json");
      expect(syncContent).toContain(tempTargetDir);

      // Check ralph.sh
      const ralphContent = await fs.readFile(join(repoMirrorDir, "ralph.sh"), "utf8");
      expect(ralphContent).toContain("while :");
      expect(ralphContent).toContain("./.repomirror/sync.sh");

      // Check .gitignore
      const gitignoreContent = await fs.readFile(join(repoMirrorDir, ".gitignore"), "utf8");
      expect(gitignoreContent).toBe("claude_output.jsonl\n");

      // Check file permissions on scripts
      const syncStats = await fs.stat(join(repoMirrorDir, "sync.sh"));
      const ralphStats = await fs.stat(join(repoMirrorDir, "ralph.sh"));
      expect(syncStats.mode & 0o111).toBeTruthy(); // Executable
      expect(ralphStats.mode & 0o111).toBeTruthy(); // Executable

      // Verify success messages
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("✅ repomirror initialized successfully!"));
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Next steps:"));
    });
  });

  describe("preflight check failures", () => {
    beforeEach(() => {
      // Mock inquirer responses for all failure tests
      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });
    });

    it("should fail when target directory does not exist", async () => {
      const nonExistentDir = "/path/that/does/not/exist";
      
      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: nonExistentDir,
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(spinnerMock.fail).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
    });

    it("should fail when target directory is not a git repository", async () => {
      // Create directory but don't make it a git repo
      await fs.mkdir(tempTargetDir, { recursive: true });

      mockExeca.mockRejectedValueOnce(new Error("Not a git repository"));

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(mockExeca).toHaveBeenCalledWith("git", ["rev-parse", "--git-dir"], { cwd: tempTargetDir });
      expect(spinnerMock.fail).toHaveBeenCalledWith(expect.stringContaining("is not a git repository"));
    });

    it("should fail when target directory has no git remotes", async () => {
      await createMockGitRepo(tempTargetDir, false);

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse success
        .mockResolvedValueOnce({ stdout: "", exitCode: 0 }); // git remote -v empty

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(mockExeca).toHaveBeenCalledWith("git", ["remote", "-v"], { cwd: tempTargetDir });
      expect(spinnerMock.fail).toHaveBeenCalledWith(expect.stringContaining("has no git remotes configured"));
    });

    it("should fail when Claude Code is not configured", async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse success
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)", 
          exitCode: 0 
        }) // git remote -v success
        .mockRejectedValueOnce(new Error("claude command not found")); // claude test failure

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(mockExeca).toHaveBeenCalledWith("claude", ["-p", "say hi"]);
      expect(spinnerMock.fail).toHaveBeenCalledWith(expect.stringContaining("Claude Code is not properly configured"));
    });

    it("should fail when Claude Code response doesn't contain 'hi'", async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse success
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)", 
          exitCode: 0 
        }) // git remote -v success
        .mockResolvedValueOnce({ stdout: "Hello there!", exitCode: 0 }); // claude test with wrong response

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(spinnerMock.fail).toHaveBeenCalledWith(expect.stringContaining("response doesn't contain 'hi'"));
    });
  });

  describe("Claude SDK integration", () => {
    beforeEach(async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test
    });

    it("should call Claude SDK with correct metaprompt", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
      });

      await init();

      expect(mockClaudeQuery).toHaveBeenCalledWith({
        prompt: expect.stringContaining("your task is to generate an optimized prompt for repo transformation"),
      });

      const call = mockClaudeQuery.mock.calls[0][0];
      expect(call.prompt).toContain("transform python to typescript");
      expect(call.prompt).toContain("<example 1>");
      expect(call.prompt).toContain("<example 2>");
    });

    it("should handle Claude SDK errors gracefully", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        throw new Error("Claude API error");
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(spinnerMock.fail).toHaveBeenCalledWith("Failed to generate transformation prompt");
      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Claude API error"));
    });

    it("should handle empty Claude SDK response", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: "",
        };
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Failed to generate transformation prompt"));
    });

    it("should replace placeholders in generated prompt", async () => {
      const promptWithPlaceholders = `Your job is to port [SOURCE PATH] to [TARGET PATH] and maintain the repository.
Use the [TARGET_PATH]/agent/ directory as a scratchpad.`;

      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: promptWithPlaceholders,
        };
      });

      await init();

      // Check that placeholders were replaced in the prompt.md file
      const repoMirrorDir = join(tempSourceDir, ".repomirror");
      const promptContent = await fs.readFile(join(repoMirrorDir, "prompt.md"), "utf8");
      
      expect(promptContent).not.toContain("[SOURCE PATH]");
      expect(promptContent).not.toContain("[TARGET PATH]");
      expect(promptContent).not.toContain("[TARGET_PATH]");
      expect(promptContent).toContain(mockInquirerResponses.sourceRepo);
      expect(promptContent).toContain(tempTargetDir);
    });
  });

  describe("file creation", () => {
    beforeEach(async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
      });
    });

    it("should create .repomirror directory", async () => {
      await init();

      const repoMirrorDir = join(tempSourceDir, ".repomirror");
      const stats = await fs.stat(repoMirrorDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should create prompt.md with correct content", async () => {
      await init();

      const promptPath = join(tempSourceDir, ".repomirror", "prompt.md");
      const content = await fs.readFile(promptPath, "utf8");
      expect(content).toBe(mockTransformationPrompt);
    });

    it("should create executable sync.sh script", async () => {
      await init();

      const syncPath = join(tempSourceDir, ".repomirror", "sync.sh");
      const content = await fs.readFile(syncPath, "utf8");
      const stats = await fs.stat(syncPath);

      expect(content).toContain("#!/bin/bash");
      expect(content).toContain("cat .repomirror/prompt.md");
      expect(content).toContain(`--add-dir ${tempTargetDir}`);
      expect(content).toContain("npx repomirror visualize --debug");
      expect(stats.mode & 0o111).toBeTruthy(); // Check executable bit
    });

    it("should create executable ralph.sh script", async () => {
      await init();

      const ralphPath = join(tempSourceDir, ".repomirror", "ralph.sh");
      const content = await fs.readFile(ralphPath, "utf8");
      const stats = await fs.stat(ralphPath);

      expect(content).toContain("#!/bin/bash");
      expect(content).toContain("while :");
      expect(content).toContain("./.repomirror/sync.sh");
      expect(content).toContain("sleep 10");
      expect(stats.mode & 0o111).toBeTruthy(); // Check executable bit
    });

    it("should create .gitignore file", async () => {
      await init();

      const gitignorePath = join(tempSourceDir, ".repomirror", ".gitignore");
      const content = await fs.readFile(gitignorePath, "utf8");

      expect(content).toBe("claude_output.jsonl\n");
    });

    it("should handle file creation errors gracefully", async () => {
      // Mock fs.mkdir to fail - this should be caught by the try-catch and trigger process.exit(1)
      vi.spyOn(fs, "mkdir").mockRejectedValueOnce(new Error("Permission denied"));

      await expect(init()).rejects.toThrow("Process exit called with code 1");
      
      // Verify error message was logged
      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
      expect(spinnerMock.fail).toHaveBeenCalledWith("Failed to generate transformation prompt");
    });
  });

  describe("user interaction", () => {
    it("should use default values for prompts", async () => {
      await createMockGitRepo(tempTargetDir, true);

      const basename = require("path").basename;
      
      // Setup mocks to use defaults
      mockInquirerPrompt.mockResolvedValue({
        sourceRepo: "./",
        targetRepo: `../${basename(tempSourceDir)}-transformed`,
        transformationInstructions: "translate this python repo to typescript",
      });

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
      });

      // Mock directory access for the default target
      const defaultTarget = `../${basename(tempSourceDir)}-transformed`;
      vi.spyOn(fs, "access").mockImplementation(async (path) => {
        if (path === defaultTarget) {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      await init();

      expect(mockInquirerPrompt).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          default: "./"
        }),
        expect.objectContaining({
          default: expect.stringMatching(/-transformed$/)
        }),
        expect.objectContaining({
          default: "translate this python repo to typescript"
        })
      ]));
    });

    it("should handle custom user responses", async () => {
      await createMockGitRepo(tempTargetDir, true);

      const customResponses = {
        sourceRepo: "/custom/source",
        targetRepo: tempTargetDir,
        transformationInstructions: "convert java to golang",
      };

      mockInquirerPrompt.mockResolvedValue(customResponses);

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: "Custom prompt with java to golang conversion",
        };
      });

      await init();

      // Verify custom values were used in the Claude query
      expect(mockClaudeQuery).toHaveBeenCalledWith({
        prompt: expect.stringContaining("convert java to golang"),
      });

      // Check generated files contain custom values
      const syncPath = join(tempSourceDir, ".repomirror", "sync.sh");
      const syncContent = await fs.readFile(syncPath, "utf8");
      expect(syncContent).toContain(tempTargetDir);
    });
  });

  describe("error handling and exit codes", () => {
    it("should exit with code 1 on preflight check failure", async () => {
      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: "/nonexistent",
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");
    });

    it("should exit with code 1 on Claude SDK failure", async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      mockClaudeQuery.mockImplementation(async function* () {
        throw new Error("Claude API error");
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Claude API error"));
    });

    it("should handle unexpected errors gracefully", async () => {
      // Mock inquirer to throw an unexpected error
      mockInquirerPrompt.mockRejectedValue(new Error("Unexpected error"));

      await expect(init()).rejects.toThrow("Unexpected error");
    });
  });

  describe("spinner and console output", () => {
    beforeEach(async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
      });
    });

    it("should show appropriate spinner messages", async () => {
      await init();

      // Check that individual spinners were created for each preflight check
      expect(mockOra).toHaveBeenCalledWith(expect.stringContaining("Accessing"));
      expect(mockOra).toHaveBeenCalledWith(expect.stringContaining("Verifying git repository"));
      expect(mockOra).toHaveBeenCalledWith(expect.stringContaining("Listing git remotes"));
      expect(mockOra).toHaveBeenCalledWith("   Running Claude Code test command");
      expect(mockOra).toHaveBeenCalledWith("Generating transformation prompt...");

      // Check that spinners were started and succeeded (4 preflight checks + 1 generation)
      expect(spinnerMock.start).toHaveBeenCalledTimes(5);
      expect(spinnerMock.succeed).toHaveBeenCalledWith("Generated transformation prompt");
    });

    it("should show correct console output", async () => {
      await init();

      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("I'll help you maintain a transformed copy of this repo:")
      );
      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("✅ repomirror initialized successfully!")
      );
      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("Next steps:")
      );
      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("npx repomirror sync")
      );
      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("npx repomirror sync-forever")
      );
    });
  });
});