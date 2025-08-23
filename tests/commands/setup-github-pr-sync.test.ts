import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import yaml from "yaml";
import { createTempDir, cleanupTempDir, mockConsole, mockProcess } from "../helpers";

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
const { setupGithubPrSync } = await import("../../src/commands/setup-github-pr-sync");

describe("setup-github-pr-sync command", () => {
  let tempDir: string;
  let consoleMock: ReturnType<typeof mockConsole>;
  let processMock: ReturnType<typeof mockProcess>;
  let spinnerMock: any;

  beforeEach(async () => {
    tempDir = await createTempDir("repomirror-setup-pr-sync-");
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

  describe("configuration validation", () => {
    it("should error if repomirror.yaml doesn't exist", async () => {
      await expect(setupGithubPrSync()).rejects.toThrow("Process exit called with code 1");
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should read existing configuration successfully", async () => {
      // Create a valid repomirror.yaml
      const config = {
        sourceRepo: "./",
        targetRepo: "../test-transformed",
        transformationInstructions: "convert to typescript",
      };
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify(config)
      );

      mockInquirerPrompt.mockResolvedValue({
        targetRepo: "myorg/myrepo",
        timesToLoop: 3,
      });

      await setupGithubPrSync();

      // Verify workflow was created
      const workflowPath = join(tempDir, ".github", "workflows", "repomirror.yml");
      const workflowExists = await fs.access(workflowPath).then(() => true).catch(() => false);
      expect(workflowExists).toBe(true);
    });
  });

  describe("workflow generation", () => {
    beforeEach(async () => {
      // Create a valid repomirror.yaml
      const config = {
        sourceRepo: "./",
        targetRepo: "../test-transformed", 
        transformationInstructions: "convert to typescript",
      };
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify(config)
      );
    });

    it("should create workflow with correct content", async () => {
      mockInquirerPrompt.mockResolvedValue({
        targetRepo: "myorg/myrepo",
        timesToLoop: 5,
      });

      await setupGithubPrSync();

      const workflowPath = join(tempDir, ".github", "workflows", "repomirror.yml");
      const workflowContent = await fs.readFile(workflowPath, "utf-8");

      expect(workflowContent).toContain("repository: myorg/myrepo");
      expect(workflowContent).toContain("for i in $(seq 1 5);");
      expect(workflowContent).toContain("workflow_dispatch:");
      expect(workflowContent).toContain("ANTHROPIC_API_KEY");
      expect(workflowContent).toContain("npx repomirror sync-one --auto-push");
    });

    it("should handle CLI options", async () => {
      await setupGithubPrSync({
        targetRepo: "testorg/testrepo",
        timesToLoop: 2,
      });

      const workflowPath = join(tempDir, ".github", "workflows", "repomirror.yml");
      const workflowContent = await fs.readFile(workflowPath, "utf-8");

      expect(workflowContent).toContain("repository: testorg/testrepo");
      expect(workflowContent).toContain("for i in $(seq 1 2);");
    });

    it("should update repomirror.yaml with github-pr-sync settings", async () => {
      mockInquirerPrompt.mockResolvedValue({
        targetRepo: "myorg/myrepo",
        timesToLoop: 3,
      });

      await setupGithubPrSync();

      const configPath = join(tempDir, "repomirror.yaml");
      const configContent = await fs.readFile(configPath, "utf-8");
      const config = yaml.parse(configContent);

      expect(config["github-pr-sync"]).toEqual({
        targetRepo: "myorg/myrepo",
        timesToLoop: 3,
      });
    });
  });

  describe("overwrite protection", () => {
    beforeEach(async () => {
      // Create a valid repomirror.yaml
      const config = {
        sourceRepo: "./",
        targetRepo: "../test-transformed",
        transformationInstructions: "convert to typescript",
      };
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify(config)
      );

      // Create existing workflow
      const workflowDir = join(tempDir, ".github", "workflows");
      await fs.mkdir(workflowDir, { recursive: true });
      await fs.writeFile(join(workflowDir, "repomirror.yml"), "existing content");
    });

    it("should prompt before overwriting existing workflow", async () => {
      mockInquirerPrompt
        .mockResolvedValueOnce({ shouldOverwrite: false })
        .mockResolvedValueOnce({
          targetRepo: "myorg/myrepo",
          timesToLoop: 3,
        });

      await expect(setupGithubPrSync()).rejects.toThrow("Process exit called with code 0");
      expect(processMock.exit).toHaveBeenCalledWith(0);
    });

    it("should overwrite when --overwrite flag is used", async () => {
      mockInquirerPrompt.mockResolvedValue({
        targetRepo: "myorg/myrepo", 
        timesToLoop: 3,
      });

      await setupGithubPrSync({ overwrite: true });

      const workflowPath = join(tempDir, ".github", "workflows", "repomirror.yml");
      const workflowContent = await fs.readFile(workflowPath, "utf-8");
      expect(workflowContent).toContain("repository: myorg/myrepo");
      expect(workflowContent).not.toBe("existing content");
    });
  });

  describe("defaults from existing config", () => {
    it("should use existing github-pr-sync settings as defaults", async () => {
      const config = {
        sourceRepo: "./",
        targetRepo: "../test-transformed",
        transformationInstructions: "convert to typescript",
        "github-pr-sync": {
          targetRepo: "existing/repo",
          timesToLoop: 4,
        },
      };
      await fs.writeFile(
        join(tempDir, "repomirror.yaml"),
        yaml.stringify(config)
      );

      // Mock prompts to use defaults
      mockInquirerPrompt.mockResolvedValue({
        targetRepo: "existing/repo", // Should use existing default
        timesToLoop: 4, // Should use existing default
      });

      await setupGithubPrSync();

      const workflowPath = join(tempDir, ".github", "workflows", "repomirror.yml");
      const workflowContent = await fs.readFile(workflowPath, "utf-8");

      expect(workflowContent).toContain("repository: existing/repo");
      expect(workflowContent).toContain("for i in $(seq 1 4);");
    });
  });
});