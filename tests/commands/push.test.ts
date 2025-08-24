import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { execa } from "execa";
import chalk from "chalk";
import { push } from "../../src/commands/push";

// Mock dependencies
vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock("execa");
vi.mock("chalk", () => ({
  default: {
    red: vi.fn((text) => text),
    green: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
    gray: vi.fn((text) => text),
  },
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
  })),
}));

// Mock console methods
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
const mockProcessExit = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
  throw new Error(`process.exit unexpectedly called with "${code}"`);
  return undefined as never;
});

describe("push command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("configuration loading", () => {
    it("should exit with error when repomirror.yaml not found", async () => {
      // Mock file not found
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      await expect(() => push()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should exit with error when no remotes configured", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("sourceRepo: ./src\ntargetRepo: ../target\ntransformationInstructions: test transformation\nremotes: {}");
      
      await expect(() => push()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should handle no changes to commit gracefully", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        `sourceRepo: ./src
targetRepo: ../target
transformationInstructions: test transformation
remotes:
  origin:
    url: https://github.com/test/repo.git
    branch: main
    auto_push: false
push:
  default_remote: origin
  default_branch: main
  commit_prefix: "[repomirror]"`
      );

      // Mock target directory exists and is a git repo
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: ".git", stderr: "" } as any) // git rev-parse --git-dir
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git diff --cached --name-only  
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git diff --name-only
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any); // git ls-files --others --exclude-standard

      // Should complete successfully without errors
      await expect(push()).resolves.toBeUndefined();
    });
  });

  describe("git operations", () => {
    beforeEach(() => {
      const config = `sourceRepo: ./src
targetRepo: ../target
transformationInstructions: test transformation
remotes:
  origin:
    url: https://github.com/test/repo.git
    branch: main
    auto_push: false
push:
  default_remote: origin
  default_branch: main
  commit_prefix: "[repomirror]"`;

      vi.mocked(fs.readFile).mockResolvedValue(config);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: ".git", stderr: "" } as any); // git rev-parse --git-dir
    });

    it("should detect changes and create commit", async () => {
      // Mock git status showing changes
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: "file1.txt", stderr: "" } as any) // git diff --cached --name-only
        .mockResolvedValueOnce({ stdout: "file2.txt", stderr: "" } as any) // git diff --name-only  
        .mockResolvedValueOnce({ stdout: "file3.txt", stderr: "" } as any) // git ls-files --others --exclude-standard
        .mockResolvedValueOnce({ stdout: "abc123f", stderr: "" } as any) // git rev-parse HEAD (source)
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git add .
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git commit -m
        .mockResolvedValueOnce({ stdout: "success", stderr: "" } as any); // git push

      await push();

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "git", 
        ["commit", "-m", expect.stringContaining("[repomirror]")], 
        { cwd: "../target" }
      );
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "git", 
        ["push", "origin", "main"], 
        { cwd: "../target", timeout: 60000 }
      );
    });

    it("should handle push to all remotes", async () => {
      const config = `sourceRepo: ./src
targetRepo: ../target
transformationInstructions: test transformation
remotes:
  origin:
    url: https://github.com/test/repo.git
    branch: main
  staging:
    url: https://github.com/test/staging.git
    branch: develop
push:
  default_remote: origin`;

      vi.mocked(fs.readFile).mockResolvedValue(config);

      // Mock git status showing changes
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: "file1.txt", stderr: "" } as any) // git diff --cached --name-only
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git diff --name-only
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git ls-files --others --exclude-standard
        .mockResolvedValueOnce({ stdout: "abc123f", stderr: "" } as any) // git rev-parse HEAD (source)
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git add .
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git commit -m
        .mockResolvedValueOnce({ stdout: "success", stderr: "" } as any) // git push origin main
        .mockResolvedValueOnce({ stdout: "success", stderr: "" } as any); // git push staging develop

      await push({ all: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "git", 
        ["push", "origin", "main"], 
        { cwd: "../target", timeout: 60000 }
      );
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "git", 
        ["push", "staging", "develop"], 
        { cwd: "../target", timeout: 60000 }
      );
    });

    it("should perform dry run without committing", async () => {
      // Mock git status showing changes
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: "file1.txt", stderr: "" } as any) // git diff --cached --name-only
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git diff --name-only
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git ls-files --others --exclude-standard  
        .mockResolvedValueOnce({ stdout: "abc123f", stderr: "" } as any) // git rev-parse HEAD (source)
        .mockResolvedValueOnce({ stdout: "dry-run output", stderr: "" } as any); // git push --dry-run

      await push({ dryRun: true });

      // Should not call git add or git commit
      expect(vi.mocked(execa)).not.toHaveBeenCalledWith(
        "git", 
        ["add", "."], 
        expect.any(Object)
      );
      expect(vi.mocked(execa)).not.toHaveBeenCalledWith(
        "git", 
        expect.arrayContaining(["commit"]), 
        expect.any(Object)
      );

      // Should call git push --dry-run
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "git", 
        ["push", "--dry-run", "origin", "main"], 
        { cwd: "../target", timeout: 60000 }
      );
    });
  });

  describe("error handling", () => {
    it("should handle authentication errors gracefully", async () => {
      const config = `sourceRepo: ./src
targetRepo: ../target
transformationInstructions: test transformation
remotes:
  origin:
    url: https://github.com/test/repo.git
    branch: main
push:
  default_remote: origin`;

      vi.mocked(fs.readFile).mockResolvedValue(config);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      // Mock successful initial checks but failed push with auth error
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: ".git", stderr: "" } as any) // git rev-parse --git-dir
        .mockResolvedValueOnce({ stdout: "file1.txt", stderr: "" } as any) // git diff --cached --name-only
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git diff --name-only
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git ls-files --others --exclude-standard
        .mockResolvedValueOnce({ stdout: "abc123f", stderr: "" } as any) // git rev-parse HEAD (source)
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git add .
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git commit -m
        .mockRejectedValueOnce(new Error("authentication failed")); // git push fails

      await expect(() => push()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });
  });
});