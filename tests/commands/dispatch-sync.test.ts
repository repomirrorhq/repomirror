import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { execa } from "execa";
import inquirer from "inquirer";
import chalk from "chalk";
import { dispatchSync } from "../../src/commands/dispatch-sync";

// Mock dependencies
vi.mock("fs", () => ({
  promises: {
    access: vi.fn(),
  },
}));

vi.mock("execa");
vi.mock("inquirer");
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

describe("dispatch-sync command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("flag validation", () => {
    it("should exit with error when --quiet is used without --yes", async () => {
      await expect(() => dispatchSync({ quiet: true, yes: false })).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should allow --yes without --quiet", async () => {
      // Mock workflow exists
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      // Mock gh CLI installed
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "gh version 2.0.0", stderr: "" } as any);
      
      // Mock git remote origin URL
      vi.mocked(execa).mockResolvedValueOnce({ 
        stdout: "https://github.com/testowner/testrepo.git", 
        stderr: "" 
      } as any);
      
      // Mock workflow dispatch
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "workflow dispatched", stderr: "" } as any);

      await expect(dispatchSync({ yes: true, quiet: false })).resolves.toBeUndefined();
    });

    it("should allow --yes and --quiet together", async () => {
      // Mock workflow exists
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      // Mock gh CLI installed
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "gh version 2.0.0", stderr: "" } as any);
      
      // Mock git remote origin URL
      vi.mocked(execa).mockResolvedValueOnce({ 
        stdout: "https://github.com/testowner/testrepo.git", 
        stderr: "" 
      } as any);
      
      // Mock workflow dispatch
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "workflow dispatched", stderr: "" } as any);

      await expect(dispatchSync({ yes: true, quiet: true })).resolves.toBeUndefined();
    });
  });

  describe("prerequisite checks", () => {
    it("should exit when workflow file doesn't exist", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

      await expect(() => dispatchSync()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should exit when gh CLI is not installed", async () => {
      // Mock workflow exists
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      // Mock gh CLI not installed
      vi.mocked(execa).mockRejectedValueOnce(new Error("command not found"));

      await expect(() => dispatchSync()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should exit when git repository info cannot be determined", async () => {
      // Mock workflow exists
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      // Mock gh CLI installed
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "gh version 2.0.0", stderr: "" } as any);
      
      // Mock git remote origin URL failure
      vi.mocked(execa).mockRejectedValueOnce(new Error("no remote origin"));

      await expect(() => dispatchSync()).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });
  });

  describe("user confirmation", () => {
    beforeEach(() => {
      // Mock all prerequisite checks pass
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: "gh version 2.0.0", stderr: "" } as any) // gh --version
        .mockResolvedValueOnce({ 
          stdout: "https://github.com/testowner/testrepo.git", 
          stderr: "" 
        } as any); // git config --get remote.origin.url
    });

    it("should prompt for confirmation when --yes is not provided", async () => {
      // Mock user confirms
      vi.mocked(inquirer.prompt).mockResolvedValue({ shouldProceed: true });
      
      // Mock workflow dispatch
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "workflow dispatched", stderr: "" } as any);

      await dispatchSync();

      expect(inquirer.prompt).toHaveBeenCalledWith([
        {
          type: "confirm",
          name: "shouldProceed",
          message: "Do you want to dispatch the workflow?",
          default: true,
        },
      ]);
    });

    it("should exit when user declines confirmation", async () => {
      // Mock user declines
      vi.mocked(inquirer.prompt).mockResolvedValue({ shouldProceed: false });

      await expect(() => dispatchSync()).rejects.toThrow("process.exit unexpectedly called with \"0\"");
    });

    it("should skip confirmation when --yes is provided", async () => {
      // Mock workflow dispatch
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "workflow dispatched", stderr: "" } as any);

      await dispatchSync({ yes: true });

      expect(inquirer.prompt).not.toHaveBeenCalled();
    });
  });

  describe("workflow dispatch", () => {
    beforeEach(() => {
      // Mock all prerequisite checks pass
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: "gh version 2.0.0", stderr: "" } as any) // gh --version
        .mockResolvedValueOnce({ 
          stdout: "https://github.com/testowner/testrepo.git", 
          stderr: "" 
        } as any); // git config --get remote.origin.url
    });

    it("should successfully dispatch workflow", async () => {
      // Mock workflow dispatch
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "workflow dispatched", stderr: "" } as any);

      await dispatchSync({ yes: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("gh", [
        "workflow",
        "run",
        "repomirror.yml",
        "--repo",
        "testowner/testrepo",
      ]);
    });

    it("should handle workflow dispatch failure", async () => {
      // Mock workflow dispatch failure
      vi.mocked(execa).mockRejectedValueOnce(new Error("workflow not found"));

      await expect(() => dispatchSync({ yes: true })).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should handle authentication errors", async () => {
      // Mock authentication error
      vi.mocked(execa).mockRejectedValueOnce(new Error("authentication failed"));

      await expect(() => dispatchSync({ yes: true })).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });

    it("should handle workflow not found errors", async () => {
      // Mock workflow not found error
      vi.mocked(execa).mockRejectedValueOnce(new Error("not found"));

      await expect(() => dispatchSync({ yes: true })).rejects.toThrow("process.exit unexpectedly called with \"1\"");
    });
  });

  describe("repository URL parsing", () => {
    beforeEach(() => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "gh version 2.0.0", stderr: "" } as any);
    });

    it("should parse HTTPS GitHub URL correctly", async () => {
      vi.mocked(execa).mockResolvedValueOnce({ 
        stdout: "https://github.com/owner/repo.git", 
        stderr: "" 
      } as any);
      
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "dispatched", stderr: "" } as any);

      await dispatchSync({ yes: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("gh", [
        "workflow",
        "run",
        "repomirror.yml",
        "--repo",
        "owner/repo",
      ]);
    });

    it("should parse SSH GitHub URL correctly", async () => {
      vi.mocked(execa).mockResolvedValueOnce({ 
        stdout: "git@github.com:owner/repo.git", 
        stderr: "" 
      } as any);
      
      vi.mocked(execa).mockResolvedValueOnce({ stdout: "dispatched", stderr: "" } as any);

      await dispatchSync({ yes: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("gh", [
        "workflow",
        "run",
        "repomirror.yml",
        "--repo",
        "owner/repo",
      ]);
    });
  });

  describe("output modes", () => {
    beforeEach(() => {
      // Mock all prerequisite checks pass
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: "gh version 2.0.0", stderr: "" } as any)
        .mockResolvedValueOnce({ 
          stdout: "https://github.com/testowner/testrepo.git", 
          stderr: "" 
        } as any)
        .mockResolvedValueOnce({ stdout: "workflow dispatched", stderr: "" } as any);
    });

    it("should complete successfully in normal mode", async () => {
      await expect(dispatchSync({ yes: true })).resolves.toBeUndefined();
    });

    it("should complete successfully in quiet mode", async () => {
      await expect(dispatchSync({ yes: true, quiet: true })).resolves.toBeUndefined();
    });
  });
});