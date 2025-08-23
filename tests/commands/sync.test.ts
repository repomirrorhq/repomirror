import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import {
  createTempDir,
  cleanupTempDir,
  mockConsole,
  mockProcess,
  createMockFileStructure,
} from "../helpers/test-utils";

// Mock external dependencies at module level
const mockExeca = vi.fn();

vi.mock("execa", () => ({
  execa: mockExeca,
}));

// Import the module after mocking
const { sync } = await import("../../src/commands/sync");

describe("sync command", () => {
  let tempDir: string;
  let consoleMock: ReturnType<typeof mockConsole>;
  let processMock: ReturnType<typeof mockProcess>;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await createTempDir("repomirror-sync-");

    // Setup mocks
    consoleMock = mockConsole();
    processMock = mockProcess(true); // Throw on process.exit by default

    // Mock process.cwd to return our temp directory
    processMock.cwd.mockReturnValue(tempDir);

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup temp directory
    await cleanupTempDir(tempDir);

    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("successful execution", () => {
    it("should execute sync.sh successfully when script exists", async () => {
      // Create .repomirror directory and sync.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": `#!/bin/bash
cat .repomirror/prompt.md | \\
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir ../target | \\
        tee -a .repomirror/claude_output.jsonl | \\
        npx repomirror visualize --debug;`,
        },
      });

      // Mock successful execa execution
      mockExeca.mockResolvedValue({
        stdout: "Sync completed",
        stderr: "",
        exitCode: 0,
      });

      // Run sync
      await sync();

      // Verify execa was called with correct parameters
      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "sync.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });

      // Verify console output
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running sync.sh..."));
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));

      // Verify process.exit was not called
      expect(processMock.exit).not.toHaveBeenCalled();
    });

    it("should use correct working directory and script path", async () => {
      // Create .repomirror directory and sync.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'test sync'",
        },
      });

      // Mock successful execa execution
      mockExeca.mockResolvedValue({
        stdout: "test sync",
        stderr: "",
        exitCode: 0,
      });

      await sync();

      const expectedScriptPath = join(tempDir, ".repomirror", "sync.sh");

      // Verify execa was called with absolute path to sync.sh
      expect(mockExeca).toHaveBeenCalledWith("bash", [expectedScriptPath], {
        stdio: "inherit",
        cwd: tempDir,
      });
    });

    it("should inherit stdio for interactive output", async () => {
      // Create .repomirror directory and sync.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'interactive output'",
        },
      });

      mockExeca.mockResolvedValue({
        stdout: "interactive output",
        stderr: "",
        exitCode: 0,
      });

      await sync();

      // Verify stdio: "inherit" was passed to execa
      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        [join(tempDir, ".repomirror", "sync.sh")],
        expect.objectContaining({
          stdio: "inherit",
        })
      );
    });
  });

  describe("error cases", () => {
    it("should exit with error when .repomirror/sync.sh does not exist", async () => {
      // Don't create the sync.sh script

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      // Verify error message
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);

      // Verify execa was not called
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it("should exit with error when .repomirror directory does not exist", async () => {
      // Don't create the .repomirror directory at all

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      // Verify error message
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);

      // Verify execa was not called
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it("should handle script execution errors gracefully", async () => {
      // Create .repomirror directory and sync.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\nexit 1",
        },
      });

      // Mock failed execa execution
      const scriptError = new Error("Script execution failed");
      (scriptError as any).exitCode = 1;
      mockExeca.mockRejectedValue(scriptError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      // Verify initial success message
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running sync.sh..."));

      // Verify error message
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: Script execution failed")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle non-Error exceptions in script execution", async () => {
      // Create .repomirror directory and sync.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'failing'",
        },
      });

      // Mock execa to throw a non-Error object
      mockExeca.mockRejectedValue("String error");

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      // Verify error message handles non-Error exceptions
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: String error")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("console output verification", () => {
    beforeEach(async () => {
      // Create .repomirror directory and sync.sh script for all output tests
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'sync output'",
        },
      });
    });

    it("should show cyan colored 'Running sync.sh...' message", async () => {
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await sync();

      // Check that the running message was logged
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running sync.sh..."));
    });

    it("should show green colored success message on completion", async () => {
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await sync();

      // Check that the success message was logged
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
    });

    it("should show red colored error message on failure", async () => {
      const error = new Error("Command failed");
      mockExeca.mockRejectedValue(error);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      // Check that the error message was logged
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: Command failed")
      );
    });

    it("should show red colored error message when sync.sh is missing", async () => {
      // Remove the sync.sh script
      await fs.rm(join(tempDir, ".repomirror", "sync.sh"));

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      // Check that the missing file error message was logged
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.")
      );
    });
  });

  describe("file system access patterns", () => {
    it("should use fs.access to check file existence", async () => {
      const fsAccessSpy = vi.spyOn(fs, "access");

      // Create the script so access check passes
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'test'",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await sync();

      // Verify fs.access was called with the correct path
      expect(fsAccessSpy).toHaveBeenCalledWith(join(tempDir, ".repomirror", "sync.sh"));

      fsAccessSpy.mockRestore();
    });

    it("should handle permission denied errors on file access", async () => {
      const fsAccessSpy = vi.spyOn(fs, "access");
      fsAccessSpy.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      // Verify the error message still shows file not found (since we catch all access errors)
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.")
      );

      fsAccessSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle empty script content", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await sync();

      // Should still execute successfully
      expect(mockExeca).toHaveBeenCalled();
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
    });

    it("should handle script with complex bash syntax", async () => {
      const complexScript = `#!/bin/bash
set -euo pipefail

# Complex sync script with pipes and redirects
cat .repomirror/prompt.md | \\
  claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir ../target | \\
  tee -a .repomirror/claude_output.jsonl | \\
  npx repomirror visualize --debug

if [ $? -eq 0 ]; then
  echo "Sync successful"
else
  echo "Sync failed" >&2
  exit 1
fi`;

      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": complexScript,
        },
      });

      mockExeca.mockResolvedValue({ stdout: "Sync successful", stderr: "", exitCode: 0 });

      await sync();

      // Should execute the complex script successfully
      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "sync.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
    });

    it("should handle scripts in different working directories", async () => {
      const subdirPath = join(tempDir, "subdir");
      await fs.mkdir(subdirPath, { recursive: true });

      // Mock cwd to return subdirectory
      processMock.cwd.mockReturnValue(subdirPath);

      // Create script in subdirectory's .repomirror folder
      await createMockFileStructure(subdirPath, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'subdir sync'",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "subdir sync", stderr: "", exitCode: 0 });

      await sync();

      // Should use the subdirectory as working directory
      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        [join(subdirPath, ".repomirror", "sync.sh")],
        expect.objectContaining({
          cwd: subdirPath,
        })
      );
    });
  });

  describe("process and signal handling", () => {
    it("should preserve working directory context", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\npwd",
        },
      });

      mockExeca.mockResolvedValue({ stdout: tempDir, stderr: "", exitCode: 0 });

      await sync();

      // Verify that execa is called with the correct working directory
      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        [join(tempDir, ".repomirror", "sync.sh")],
        expect.objectContaining({
          cwd: tempDir,
        })
      );
    });

    it("should handle bash command execution with proper shell", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'bash execution'",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "bash execution", stderr: "", exitCode: 0 });

      await sync();

      // Verify that bash is used as the shell command
      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        expect.any(Array),
        expect.any(Object)
      );
    });
  });
});