import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import {
  createTempDir,
  cleanupTempDir,
  mockConsole,
  mockProcess,
} from "../helpers/test-utils";

// Mock external dependencies
const mockInquirerPrompt = vi.fn();
const mockOra = vi.fn();

vi.mock("inquirer", () => ({
  default: {
    prompt: mockInquirerPrompt,
  },
}));

vi.mock("ora", () => ({
  default: mockOra,
}));

// Import after mocking
const { githubActions } = await import("../../src/commands/github-actions");

describe("github-actions command", () => {
  let tempDir: string;
  let consoleMock: ReturnType<typeof mockConsole>;
  let processMock: ReturnType<typeof mockProcess>;
  let spinnerMock: any;

  beforeEach(async () => {
    tempDir = await createTempDir("repomirror-github-actions-");
    consoleMock = mockConsole();
    processMock = mockProcess(true);
    processMock.cwd.mockReturnValue(tempDir);

    spinnerMock = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
    };
    mockOra.mockReturnValue(spinnerMock);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.restoreAllMocks();
  });

  describe("successful workflow generation", () => {
    beforeEach(async () => {
      // Create a mock repomirror.yaml
      const config = {
        sourceRepo: "./",
        targetRepo: "../myrepo-transformed",
        transformationInstructions: "transform to typescript",
      };
      const yaml = await import("yaml");
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify(config),
      );
    });

    it("should create GitHub Actions workflow with defaults", async () => {
      mockInquirerPrompt.mockResolvedValue({
        workflowName: "repomirror-sync.yml",
        schedule: "0 */6 * * *",
        autoPush: true,
        targetRepo: "user/myrepo-transformed",
      });

      await githubActions();

      // Check workflow directory was created
      const workflowDir = join(tempDir, ".github", "workflows");
      const dirStats = await fs.stat(workflowDir);
      expect(dirStats.isDirectory()).toBe(true);

      // Check workflow file was created
      const workflowPath = join(workflowDir, "repomirror-sync.yml");
      const workflowContent = await fs.readFile(workflowPath, "utf-8");

      // Verify content includes expected elements
      expect(workflowContent).toContain("name: RepoMirror Sync");
      expect(workflowContent).toContain("cron: '0 */6 * * *'");
      expect(workflowContent).toContain("repository: user/myrepo-transformed");
      expect(workflowContent).toContain("if: true");

      // Verify success messages
      expect(spinnerMock.succeed).toHaveBeenCalledWith(
        "GitHub Actions workflow created",
      );
      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("✅ Workflow created"),
      );
    });

    it("should handle CLI options correctly", async () => {
      mockInquirerPrompt.mockResolvedValue({
        targetRepo: "org/repo",
      });

      await githubActions({
        workflowName: "custom.yml",
        schedule: "0 0 * * *",
        autoPush: false,
      });

      const workflowPath = join(tempDir, ".github", "workflows", "custom.yml");
      const workflowContent = await fs.readFile(workflowPath, "utf-8");

      expect(workflowContent).toContain("cron: '0 0 * * *'");
      expect(workflowContent).toContain("if: false");
      expect(mockInquirerPrompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: "targetRepo",
          }),
        ]),
      );
    });

    it("should validate workflow file extension", async () => {
      mockInquirerPrompt.mockImplementation((questions) => {
        const workflowQuestion = questions.find(
          (q: any) => q.name === "workflowName",
        );
        if (workflowQuestion && workflowQuestion.validate) {
          expect(workflowQuestion.validate("test.yml")).toBe(true);
          expect(workflowQuestion.validate("test.yaml")).toBe(true);
          expect(workflowQuestion.validate("test.txt")).toBe(
            "Workflow file must end with .yml or .yaml",
          );
        }
        return Promise.resolve({
          workflowName: "test.yml",
          schedule: "0 */6 * * *",
          autoPush: true,
          targetRepo: "user/repo",
        });
      });

      await githubActions();
    });
  });

  describe("error handling", () => {
    it("should exit when repomirror.yaml not found", async () => {
      await expect(githubActions()).rejects.toThrow(
        "Process exit called with code 1",
      );

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("repomirror.yaml not found"),
      );
      expect(consoleMock.log).toHaveBeenCalledWith(
        expect.stringContaining("npx repomirror init"),
      );
    });

    it("should handle file write errors", async () => {
      // Create config
      const yaml = await import("yaml");
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify({ sourceRepo: "./", targetRepo: "../target" }),
      );

      mockInquirerPrompt.mockResolvedValue({
        workflowName: "test.yml",
        schedule: "0 */6 * * *",
        autoPush: true,
        targetRepo: "user/repo",
      });

      // Mock writeFile to fail
      const originalWriteFile = fs.writeFile;
      vi.spyOn(fs, "writeFile").mockImplementation((path, content, options) => {
        if (typeof path === "string" && path.endsWith(".yml")) {
          throw new Error("Permission denied");
        }
        return originalWriteFile(path as any, content, options);
      });

      await expect(githubActions()).rejects.toThrow(
        "Process exit called with code 1",
      );

      expect(spinnerMock.fail).toHaveBeenCalledWith(
        "Failed to create workflow",
      );
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Permission denied"),
      );
    });
  });

  describe("workflow content generation", () => {
    beforeEach(async () => {
      const yaml = await import("yaml");
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify({
          sourceRepo: "./",
          targetRepo: "../target",
          transformationInstructions: "test",
        }),
      );
    });

    it("should include all required workflow steps", async () => {
      mockInquirerPrompt.mockResolvedValue({
        workflowName: "test.yml",
        schedule: "0 */6 * * *",
        autoPush: true,
        targetRepo: "user/repo",
      });

      await githubActions();

      const workflowPath = join(tempDir, ".github", "workflows", "test.yml");
      const content = await fs.readFile(workflowPath, "utf-8");

      // Check for essential workflow components
      expect(content).toContain("on:");
      expect(content).toContain("schedule:");
      expect(content).toContain("workflow_dispatch:");
      expect(content).toContain("uses: actions/checkout@v3");
      expect(content).toContain("uses: actions/setup-node@v3");
      expect(content).toContain("npm install -g repomirror");
      expect(content).toContain("npx repomirror sync");
      expect(content).toContain("CLAUDE_API_KEY");
      expect(content).toContain("SKIP_CLAUDE_TEST: true");
    });

    it("should handle custom schedule correctly", async () => {
      mockInquirerPrompt.mockResolvedValue({
        workflowName: "test.yml",
        schedule: "*/15 * * * *",
        autoPush: true,
        targetRepo: "user/repo",
      });

      await githubActions();

      const workflowPath = join(tempDir, ".github", "workflows", "test.yml");
      const content = await fs.readFile(workflowPath, "utf-8");

      expect(content).toContain("cron: '*/15 * * * *'");
    });

    it("should disable auto-push when requested", async () => {
      mockInquirerPrompt.mockResolvedValue({
        workflowName: "test.yml",
        schedule: "0 */6 * * *",
        autoPush: false,
        targetRepo: "user/repo",
      });

      await githubActions();

      const workflowPath = join(tempDir, ".github", "workflows", "test.yml");
      const content = await fs.readFile(workflowPath, "utf-8");

      expect(content).toContain("if: false");
    });
  });

  describe("user prompts and validation", () => {
    beforeEach(async () => {
      const yaml = await import("yaml");
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify({
          sourceRepo: "./",
          targetRepo: "../myrepo-transformed",
          transformationInstructions: "test",
        }),
      );
    });

    it("should validate target repo format", async () => {
      mockInquirerPrompt.mockImplementation((questions) => {
        const targetQuestion = questions.find(
          (q: any) => q.name === "targetRepo",
        );
        if (targetQuestion && targetQuestion.validate) {
          expect(targetQuestion.validate("")).toBe(
            "Please provide the GitHub repository in owner/repo format",
          );
          expect(targetQuestion.validate("../myrepo-transformed")).toBe(
            "Please provide the GitHub repository in owner/repo format",
          );
          expect(targetQuestion.validate("user/repo")).toBe(true);
        }
        return Promise.resolve({
          workflowName: "test.yml",
          schedule: "0 */6 * * *",
          autoPush: true,
          targetRepo: "user/repo",
        });
      });

      await githubActions();
    });

    it("should provide sensible defaults", async () => {
      mockInquirerPrompt.mockImplementation((questions) => {
        const nameQuestion = questions.find(
          (q: any) => q.name === "workflowName",
        );
        const scheduleQuestion = questions.find(
          (q: any) => q.name === "schedule",
        );
        const pushQuestion = questions.find(
          (q: any) => q.name === "autoPush",
        );

        expect(nameQuestion?.default).toBe("repomirror-sync.yml");
        expect(scheduleQuestion?.default).toBe("0 */6 * * *");
        expect(pushQuestion?.default).toBe(true);

        return Promise.resolve({
          workflowName: "test.yml",
          schedule: "0 */6 * * *",
          autoPush: true,
          targetRepo: "user/repo",
        });
      });

      await githubActions();
    });
  });
});