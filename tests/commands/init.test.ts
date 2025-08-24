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
      expect(mockExeca).toHaveBeenCalledWith("claude", ["-p", "say hi"], { timeout: 30000, input: "" });

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

      expect(mockExeca).toHaveBeenCalledWith("claude", ["-p", "say hi"], { timeout: 30000, input: "" });
      expect(spinnerMock.fail).toHaveBeenCalledWith(expect.stringContaining("Claude Code is not properly configured"));
    });

    it("should fail when Claude Code response is too short", async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse success
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)", 
          exitCode: 0 
        }) // git remote -v success
        .mockResolvedValueOnce({ stdout: "Hi", exitCode: 0 }); // claude test with response too short (< 10 chars)

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(spinnerMock.fail).toHaveBeenCalledWith(expect.stringContaining("response was empty or too short"));
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

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("✖ Failed to generate transformation prompt"));
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
      // Mock fs.mkdir to fail on the .repomirror directory creation
      // This happens in createRepoMirrorFiles which is inside the try-catch
      const mkdirSpy = vi.spyOn(fs, "mkdir");
      let callCount = 0;
      mkdirSpy.mockImplementation(async (path, options) => {
        callCount++;
        // Let the first call (for config directory) succeed
        if (callCount === 1) {
          return Promise.resolve(undefined);
        }
        // Fail on the second call (for .repomirror directory)
        throw new Error("Permission denied");
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");
      
      // Verify error message was logged
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("✖ Failed to generate transformation prompt"));
      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
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
        // Allow access to template files
        if (typeof path === 'string' && path.includes('templates')) {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      // Mock readFile for templates
      vi.spyOn(fs, "readFile").mockImplementation(async (path, encoding) => {
        if (typeof path === 'string') {
          if (path.includes('sync.sh.template')) {
            return `#!/bin/bash
cat .repomirror/prompt.md | \\
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir \${targetRepo} | \\
        tee -a .repomirror/claude_output.jsonl | \\
        npx repomirror visualize --debug;`;
          }
          if (path.includes('ralph.sh.template')) {
            return `#!/bin/bash
while :; do
  ./.repomirror/sync.sh
  echo -e "===SLEEP===\\n===SLEEP===\\n"; echo 'looping';
  sleep 10;
done`;
          }
          if (path.includes('gitignore.template')) {
            return 'claude_output.jsonl';
          }
        }
        return Promise.reject(new Error("File not found"));
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

      // Create a custom source directory for testing
      const customSourceDir = await createTempDir("custom-source-");
      
      const customResponses = {
        sourceRepo: customSourceDir,
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
      const syncPath = join(customSourceDir, ".repomirror", "sync.sh");
      const syncContent = await fs.readFile(syncPath, "utf8");
      expect(syncContent).toContain(tempTargetDir);
      
      // Clean up custom source dir
      await cleanupTempDir(customSourceDir);
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

      // Check that spinners were started and succeeded (4 preflight checks only)
      expect(spinnerMock.start).toHaveBeenCalledTimes(4);
      
      // Check that console.log was called for generating prompt message
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Generating transformation prompt..."));
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("✔ Generated transformation prompt"));
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

  describe("configuration file handling", () => {
    beforeEach(async () => {
      await createMockGitRepo(tempTargetDir, true);

      // Reset mocks between tests in this describe block
      vi.clearAllMocks();

      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
      });
    });

    it("should create repomirror.yaml config file", async () => {
      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });

      await init();

      const configPath = join(tempSourceDir, "repomirror.yaml");
      const configExists = await fs.stat(configPath).then(() => true).catch(() => false);
      expect(configExists).toBe(true);

      const configContent = await fs.readFile(configPath, "utf-8");
      const yaml = await import("yaml");
      const config = yaml.parse(configContent);
      
      expect(config).toEqual({
        sourceRepo: mockInquirerResponses.sourceRepo,
        targetRepo: tempTargetDir,
        transformationInstructions: mockInquirerResponses.transformationInstructions,
      });

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("✅ Saved configuration to repomirror.yaml"));
    });

    it("should load existing repomirror.yaml as defaults", async () => {
      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      // Create existing config file with the tempTargetDir that's already set up
      const existingConfig = {
        sourceRepo: "./existing-source", 
        targetRepo: tempTargetDir, // Use the temp target dir from the test setup
        transformationInstructions: "existing transformation instructions",
      };
      
      const yaml = await import("yaml");
      const configContent = yaml.stringify(existingConfig);
      await fs.writeFile(join(tempSourceDir, "repomirror.yaml"), configContent, "utf-8");

      // Mock inquirer to use defaults - return the existing config values
      // Since the existing config is loaded, inquirer should get these as defaults
      mockInquirerPrompt.mockResolvedValue({
        sourceRepo: "./existing-source",
        targetRepo: tempTargetDir,
        transformationInstructions: "existing transformation instructions",
      });

      await init();

      // Verify the existing config message was shown
      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("Found existing repomirror.yaml, using as defaults")
      );

      // Verify the existing config was used
      expect(mockClaudeQuery).toHaveBeenCalledWith({
        prompt: expect.stringContaining("existing transformation instructions"),
      });

      // Verify the config file was updated with the same values
      const finalConfigContent = await fs.readFile(join(tempSourceDir, "repomirror.yaml"), "utf-8");
      const finalConfig = yaml.parse(finalConfigContent);
      expect(finalConfig).toEqual(existingConfig);
    });

    it("should handle corrupted repomirror.yaml gracefully", async () => {
      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      // Create corrupted YAML file
      await fs.writeFile(join(tempSourceDir, "repomirror.yaml"), "invalid: yaml: content: [", "utf-8");

      mockInquirerPrompt.mockResolvedValue({
        ...mockInquirerResponses,
        targetRepo: tempTargetDir,
      });

      await init();

      // Should not show the existing config message
      expect(consoleMock.log).not.toHaveBeenCalledWith(
        expect.stringContaining("Found existing repomirror.yaml, using as defaults")
      );

      // Should create new valid config
      const configPath = join(tempSourceDir, "repomirror.yaml");
      const configContent = await fs.readFile(configPath, "utf-8");
      const yaml = await import("yaml");
      const config = yaml.parse(configContent);
      expect(config.sourceRepo).toBeDefined();
    });

    it("should save config with normalized paths", async () => {
      mockExeca
        .mockResolvedValueOnce({ stdout: ".git", exitCode: 0 }) // git rev-parse
        .mockResolvedValueOnce({ 
          stdout: "origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)", 
          exitCode: 0 
        }) // git remote -v
        .mockResolvedValueOnce({ stdout: "Hi there! How can I help you today?", exitCode: 0 }); // claude test

      const inputPaths = {
        sourceRepo: "./source/../source/./",
        targetRepo: "../target/./nested/../",
        transformationInstructions: "test transformation",
      };

      mockInquirerPrompt.mockResolvedValue({
        ...inputPaths,
        targetRepo: tempTargetDir, // Use valid temp dir for preflight checks
      });

      await init();

      // Config should be saved in the source subdirectory when sourceRepo is relative
      const configPath = join(tempSourceDir, "source/../source/./", "repomirror.yaml");
      const configContent = await fs.readFile(configPath, "utf-8");
      const yaml = await import("yaml");
      const config = yaml.parse(configContent);
      
      // Paths should be saved as entered (init doesn't normalize, that's the user's choice)
      expect(config.sourceRepo).toBe(inputPaths.sourceRepo);
      expect(config.transformationInstructions).toBe(inputPaths.transformationInstructions);
    });
  });

  describe("CLI flag overrides", () => {
    beforeEach(async () => {
      await createMockGitRepo(tempTargetDir, true);

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

    it("should skip prompts when all CLI options provided", async () => {
      const cliOptions = {
        sourceRepo: "./cli-source",
        targetRepo: tempTargetDir,
        transformationInstructions: "CLI transformation instructions",
      };

      // Mock inquirer to return empty object since all prompts have when: false
      mockInquirerPrompt.mockResolvedValue({});

      await init(cliOptions);

      // Inquirer should be called but with all when: false conditions
      expect(mockInquirerPrompt).toHaveBeenCalled();
      const promptCall = mockInquirerPrompt.mock.calls[0][0];
      expect(promptCall.every((p: any) => p.when === false)).toBe(true);

      // Verify CLI options were used in Claude query
      expect(mockClaudeQuery).toHaveBeenCalledWith({
        prompt: expect.stringContaining("CLI transformation instructions"),
      });

      // Verify config was saved with CLI values
      // Config should be saved in the cli-source subdirectory
      const configPath = join(tempSourceDir, "cli-source", "repomirror.yaml");
      const configContent = await fs.readFile(configPath, "utf-8");
      const yaml = await import("yaml");
      const config = yaml.parse(configContent);
      expect(config).toEqual(cliOptions);
    });

    it("should partially override with CLI flags", async () => {
      const cliOptions = {
        sourceRepo: "./cli-source",
        // targetRepo and transformationInstructions will come from prompt
      };

      mockInquirerPrompt.mockResolvedValue({
        targetRepo: tempTargetDir,
        transformationInstructions: "prompted instructions",
      });

      await init(cliOptions);

      // Should only prompt for missing options
      const promptCall = mockInquirerPrompt.mock.calls[0][0];
      const sourceRepoPrompt = promptCall.find((p: any) => p.name === "sourceRepo");
      const targetRepoPrompt = promptCall.find((p: any) => p.name === "targetRepo");
      const instructionsPrompt = promptCall.find((p: any) => p.name === "transformationInstructions");
      
      expect(sourceRepoPrompt.when).toBe(false); // Should skip source repo prompt
      expect(targetRepoPrompt.when).toBe(true);  // Should show target repo prompt
      expect(instructionsPrompt.when).toBe(true); // Should show instructions prompt

      // Verify final config contains CLI override
      // Config should be saved in the cli-source subdirectory
      const configPath = join(tempSourceDir, "cli-source", "repomirror.yaml");
      const configContent = await fs.readFile(configPath, "utf-8");
      const yaml = await import("yaml");
      const config = yaml.parse(configContent);
      
      expect(config.sourceRepo).toBe("./cli-source");
      expect(config.targetRepo).toBe(tempTargetDir);
      expect(config.transformationInstructions).toBe("prompted instructions");
    });

    it("should prioritize CLI flags over existing config", async () => {
      // Create existing config
      const existingConfig = {
        sourceRepo: "./existing-source",
        targetRepo: tempTargetDir, // Use the temp dir for preflight checks
        transformationInstructions: "existing instructions",
      };
      
      const yaml = await import("yaml");
      const configContent = yaml.stringify(existingConfig);
      await fs.writeFile(join(tempSourceDir, "repomirror.yaml"), configContent, "utf-8");

      // CLI overrides part of the config
      const cliOptions = {
        targetRepo: tempTargetDir,
        transformationInstructions: "CLI override instructions",
      };

      // Mock inquirer to return the sourceRepo value since it's the only one not overridden by CLI
      mockInquirerPrompt.mockResolvedValue({
        sourceRepo: "./existing-source", // Only sourceRepo should be prompted since it's not in CLI options
      });

      await init(cliOptions);

      // Verify CLI overrides were used
      expect(mockClaudeQuery).toHaveBeenCalledWith({
        prompt: expect.stringContaining("CLI override instructions"),
      });

      // Verify final config has CLI overrides
      // Config gets saved to the final sourceRepo location
      const finalConfigContent = await fs.readFile(join(tempSourceDir, "existing-source", "repomirror.yaml"), "utf-8");
      const finalConfig = yaml.parse(finalConfigContent);
      
      expect(finalConfig.sourceRepo).toBe("./existing-source"); // From existing config (no CLI override)
      expect(finalConfig.targetRepo).toBe(tempTargetDir); // CLI override
      expect(finalConfig.transformationInstructions).toBe("CLI override instructions"); // CLI override
    });

    it("should handle CLI flags with empty values", async () => {
      const cliOptions = {
        sourceRepo: "",
        targetRepo: tempTargetDir,
        transformationInstructions: undefined,
      };

      mockInquirerPrompt.mockResolvedValue({
        sourceRepo: "./prompted-source",
        transformationInstructions: "prompted instructions",
      });

      await init(cliOptions);

      // Empty CLI values should not prevent prompting
      const promptCall = mockInquirerPrompt.mock.calls[0][0];
      const sourceRepoPrompt = promptCall.find((p: any) => p.name === "sourceRepo");
      const instructionsPrompt = promptCall.find((p: any) => p.name === "transformationInstructions");
      
      expect(sourceRepoPrompt.when).toBe(true); // Empty string should allow prompting
      expect(instructionsPrompt.when).toBe(true); // undefined should allow prompting
    });
  });

  describe("Claude SDK async iterator edge cases", () => {
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

    it("should handle Claude SDK yielding multiple messages before result", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        yield { type: "other", data: "some data" };
        yield { type: "progress", percentage: 50 };
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
        yield { type: "after_result", data: "ignored" }; // Should be ignored after break
      });

      await init();

      // Should successfully create files with the result
      const promptContent = await fs.readFile(join(tempSourceDir, ".repomirror", "prompt.md"), "utf8");
      expect(promptContent).toBe(mockTransformationPrompt);
    });

    it("should handle Claude SDK yielding error result", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: true,
          result: "Claude API returned an error",
        };
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("✖ Failed to generate transformation prompt"));
      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Claude API returned an error"));
    });

    it("should handle Claude SDK yielding result with missing result field", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          is_error: false,
          // Missing result field - result property is undefined
        } as any;
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Failed to generate transformation prompt"));
    });

    it("should handle Claude SDK iterator that never yields a result", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        yield { type: "other", data: "some data" };
        yield { type: "progress", percentage: 100 };
        // Never yields a result type
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to generate transformation prompt - no result received")
      );
    });

    it("should handle Claude SDK network timeout gracefully", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
        throw new Error("Network timeout");
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("✖ Failed to generate transformation prompt"));
      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Network timeout"));
    });

    it("should handle Claude SDK iterator throwing on first yield", async () => {
      let hasYielded = false;
      mockClaudeQuery.mockImplementation(async function* () {
        if (!hasYielded) {
          hasYielded = true;
          throw new Error("Iterator initialization failed");
        }
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(expect.stringContaining("Iterator initialization failed"));
    });

    it("should handle partial Claude SDK response objects", async () => {
      mockClaudeQuery.mockImplementation(async function* () {
        yield { type: "progress" }; // Missing other fields
        yield { type: "other", data: "some data" }; // Different type
        yield { type: "status", status: "processing" }; // Different type
        yield {
          type: "result",
          is_error: false,
          result: mockTransformationPrompt,
        };
      });

      await init();

      // Should handle partial responses gracefully and use the valid result
      const promptContent = await fs.readFile(join(tempSourceDir, ".repomirror", "prompt.md"), "utf8");
      expect(promptContent).toBe(mockTransformationPrompt);
    });
  });

  describe("path resolution and normalization edge cases", () => {
    beforeEach(async () => {
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

    it("should handle absolute paths correctly", async () => {
      await createMockGitRepo(tempTargetDir, true);

      mockInquirerPrompt.mockResolvedValue({
        sourceRepo: tempSourceDir, // absolute path
        targetRepo: tempTargetDir, // absolute path
        transformationInstructions: "test transformation",
      });

      await init();

      // Check sync.sh contains the absolute path
      const syncContent = await fs.readFile(join(tempSourceDir, ".repomirror", "sync.sh"), "utf8");
      expect(syncContent).toContain(`--add-dir ${tempTargetDir}`);
    });

    it("should handle relative paths with dots and slashes", async () => {
      await createMockGitRepo(tempTargetDir, true);

      const relativePaths = {
        sourceRepo: "./src/../src/./",
        targetRepo: tempTargetDir, // Use real path for preflight checks
        transformationInstructions: "test transformation",
      };

      mockInquirerPrompt.mockResolvedValue(relativePaths);

      await init();

      // Check that paths are preserved as entered in the config
      // Config should be saved in the src/../src/./ subdirectory
      const configPath = join(tempSourceDir, "src/../src/./", "repomirror.yaml");
      const configContent = await fs.readFile(configPath, "utf-8");
      const yaml = await import("yaml");
      const config = yaml.parse(configContent);
      expect(config.sourceRepo).toBe("./src/../src/./");
    });

    it("should handle paths with spaces", async () => {
      // Create temp dir with spaces
      const tempDirWithSpaces = await createTempDir("repo mirror test ");
      await createMockGitRepo(tempDirWithSpaces, true);

      try {
        mockInquirerPrompt.mockResolvedValue({
          sourceRepo: "./source with spaces",
          targetRepo: tempDirWithSpaces,
          transformationInstructions: "test transformation",
        });

        await init();

        // Check sync.sh properly handles the path with spaces
        // Files should be in the "source with spaces" subdirectory
        const syncContent = await fs.readFile(join(tempSourceDir, "source with spaces", ".repomirror", "sync.sh"), "utf8");
        expect(syncContent).toContain(`--add-dir ${tempDirWithSpaces}`);
      } finally {
        await cleanupTempDir(tempDirWithSpaces);
      }
    });

    it("should handle empty and invalid path values", async () => {
      mockInquirerPrompt.mockResolvedValue({
        sourceRepo: "",
        targetRepo: "/invalid/nonexistent/path",
        transformationInstructions: "test transformation",
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(spinnerMock.fail).toHaveBeenCalledWith(
        expect.stringContaining("does not exist")
      );
    });

    it("should handle very long paths", async () => {
      const longDirName = "a".repeat(100);
      const tempLongDir = await createTempDir(`repomirror-long-${longDirName}-`);
      await createMockGitRepo(tempLongDir, true);

      try {
        mockInquirerPrompt.mockResolvedValue({
          sourceRepo: "./" + "nested/".repeat(20),
          targetRepo: tempLongDir,
          transformationInstructions: "test transformation",
        });

        await init();

        // Should handle long paths without issue
        // Config should be saved in the nested subdirectory
        const configPath = join(tempSourceDir, "." + "/nested".repeat(20), "repomirror.yaml");
        const configContent = await fs.readFile(configPath, "utf-8");
        const yaml = await import("yaml");
        const config = yaml.parse(configContent);
        expect(config.targetRepo).toBe(tempLongDir);
      } finally {
        await cleanupTempDir(tempLongDir);
      }
    });
  });

  describe("script generation edge cases", () => {
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

    it("should create scripts with exact file permissions", async () => {
      await init();

      const syncPath = join(tempSourceDir, ".repomirror", "sync.sh");
      const ralphPath = join(tempSourceDir, ".repomirror", "ralph.sh");
      
      const syncStats = await fs.stat(syncPath);
      const ralphStats = await fs.stat(ralphPath);

      // Check exact mode (should be 0o755)
      expect(syncStats.mode & 0o777).toBe(0o755);
      expect(ralphStats.mode & 0o777).toBe(0o755);
      
      // Check owner permissions
      expect(syncStats.mode & 0o700).toBe(0o700); // rwx for owner
      expect(ralphStats.mode & 0o700).toBe(0o700); // rwx for owner
    });

    it("should generate sync.sh with proper bash escaping", async () => {
      await init();

      const syncContent = await fs.readFile(join(tempSourceDir, ".repomirror", "sync.sh"), "utf8");
      
      // Check shebang
      expect(syncContent.startsWith("#!/bin/bash")).toBe(true);
      
      // Check line continuation
      expect(syncContent).toContain(" | \\");
      
      // Check command structure
      expect(syncContent).toContain("cat .repomirror/prompt.md");
      expect(syncContent).toContain("claude -p --output-format=stream-json");
      expect(syncContent).toContain("--verbose --dangerously-skip-permissions");
      expect(syncContent).toContain("tee -a .repomirror/claude_output.jsonl");
      expect(syncContent).toContain("npx repomirror visualize --debug");
    });

    it("should generate ralph.sh with proper loop structure", async () => {
      await init();

      const ralphContent = await fs.readFile(join(tempSourceDir, ".repomirror", "ralph.sh"), "utf8");
      
      // Check shebang
      expect(ralphContent.startsWith("#!/bin/bash")).toBe(true);
      
      // Check loop structure
      expect(ralphContent).toContain("while :; do");
      expect(ralphContent).toContain("./.repomirror/sync.sh");
      expect(ralphContent).toContain("echo -e \"===SLEEP===\\n===SLEEP===\\n\"; echo 'looping';");
      expect(ralphContent).toContain("sleep 10;");
      expect(ralphContent).toContain("done");
    });

    it("should handle file creation permission errors", async () => {
      // Mock writeFile to fail on script creation
      const originalWriteFile = fs.writeFile;
      const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (path, content, options) => {
        if (typeof path === 'string' && (path.endsWith('sync.sh') || path.endsWith('ralph.sh'))) {
          throw new Error("Permission denied: Cannot create executable file");
        }
        return originalWriteFile(path as any, content, options);
      });

      await expect(init()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Permission denied: Cannot create executable file")
      );

      writeFileSpy.mockRestore();
    });

    it("should create gitignore with correct content and no extra whitespace", async () => {
      await init();

      const gitignoreContent = await fs.readFile(join(tempSourceDir, ".repomirror", ".gitignore"), "utf8");
      
      // Check exact content
      expect(gitignoreContent).toBe("claude_output.jsonl\n");
      
      // Verify no extra whitespace
      expect(gitignoreContent.trim()).toBe("claude_output.jsonl");
      expect(gitignoreContent.split('\n')).toHaveLength(2); // content + empty line
    });
  });
});