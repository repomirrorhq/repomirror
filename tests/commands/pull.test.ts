import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { execa } from "execa";
import { pull } from "../../src/commands/pull";

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
    blue: vi.fn((text) => text),
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
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
const mockProcessExit = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
  throw new Error(`process.exit unexpectedly called with "${code}"`);
  return undefined as never;
});

describe("pull command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic functionality", () => {
    it("should exit with error when repomirror.yaml not found", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      await expect(() => pull()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should exit with error when source directory does not exist", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(`
sourceRepo: ./nonexistent
targetRepo: ../target
transformationInstructions: test transformation
pull:
  source_remote: upstream
  source_branch: main`);
      
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

      await expect(() => pull()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should trigger sync when auto_sync is enabled and changes are pulled", async () => {
      const config = `
sourceRepo: ./src
targetRepo: ../target
transformationInstructions: test transformation
pull:
  source_remote: upstream
  source_branch: main
  auto_sync: true`;
      
      vi.mocked(fs.readFile).mockResolvedValue(config);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: ".git", stderr: "" } as any) // git rev-parse --git-dir
        .mockResolvedValueOnce({ stdout: "main", stderr: "" } as any) // git branch --show-current
        .mockResolvedValueOnce({ stdout: "origin\nupstream", stderr: "" } as any) // git remote
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git status --porcelain
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git fetch upstream
        .mockResolvedValueOnce({ stdout: "1", stderr: "" } as any) // git rev-list --count HEAD..upstream/main
        .mockResolvedValueOnce({ 
          stdout: "abc123f New feature", 
          stderr: "" 
        } as any) // git log --oneline
        .mockResolvedValueOnce({ 
          stdout: "Updated 1 file", 
          stderr: "" 
        } as any) // git pull upstream main
        .mockResolvedValueOnce({ stdout: "Sync completed", stderr: "" } as any); // bash sync.sh

      await expect(pull()).resolves.toBeUndefined();
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "bash",
        expect.arrayContaining([expect.stringContaining("sync.sh")]),
        expect.objectContaining({ stdio: "inherit" })
      );
    });

    it("should handle --check option without pulling", async () => {
      const config = `
sourceRepo: ./src
targetRepo: ../target
transformationInstructions: test transformation
pull:
  source_remote: upstream
  source_branch: main`;
      
      vi.mocked(fs.readFile).mockResolvedValue(config);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: ".git", stderr: "" } as any) // git rev-parse --git-dir
        .mockResolvedValueOnce({ stdout: "main", stderr: "" } as any) // git branch --show-current
        .mockResolvedValueOnce({ stdout: "origin\nupstream", stderr: "" } as any) // git remote
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git status --porcelain
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git fetch upstream
        .mockResolvedValueOnce({ stdout: "2", stderr: "" } as any) // git rev-list --count HEAD..upstream/main
        .mockResolvedValueOnce({ 
          stdout: "abc123f Fix bug\ndef456a Update docs", 
          stderr: "" 
        } as any); // git log --oneline

      await expect(pull({ check: true })).resolves.toBeUndefined();
      
      // Should not attempt to pull
      expect(vi.mocked(execa)).not.toHaveBeenCalledWith(
        expect.anything(), 
        expect.arrayContaining(["pull"]), 
        expect.anything()
      );
    });

    it("should skip sync with --source-only option", async () => {
      const config = `
sourceRepo: ./src
targetRepo: ../target
transformationInstructions: test transformation
pull:
  source_remote: upstream
  source_branch: main`;
      
      vi.mocked(fs.readFile).mockResolvedValue(config);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: ".git", stderr: "" } as any) // git rev-parse --git-dir
        .mockResolvedValueOnce({ stdout: "main", stderr: "" } as any) // git branch --show-current
        .mockResolvedValueOnce({ stdout: "origin\nupstream", stderr: "" } as any) // git remote
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git status --porcelain
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any) // git fetch upstream
        .mockResolvedValueOnce({ stdout: "1", stderr: "" } as any) // git rev-list --count HEAD..upstream/main
        .mockResolvedValueOnce({ 
          stdout: "abc123f New feature", 
          stderr: "" 
        } as any) // git log --oneline
        .mockResolvedValueOnce({ 
          stdout: "Updated 1 file", 
          stderr: "" 
        } as any); // git pull upstream main

      await expect(pull({ sourceOnly: true })).resolves.toBeUndefined();
      
      // Should not attempt to run sync scripts
      expect(vi.mocked(execa)).not.toHaveBeenCalledWith(
        "bash",
        expect.arrayContaining([expect.stringContaining("sync.sh")]),
        expect.anything()
      );
    });
  });
});