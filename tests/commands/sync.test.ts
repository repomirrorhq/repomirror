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

  describe("shell script execution with different exit codes", () => {
    it("should handle script that exits with code 2", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\nexit 2",
        },
      });

      // Mock execa to reject with exit code 2
      const scriptError = new Error("Command failed with exit code 2");
      (scriptError as any).exitCode = 2;
      (scriptError as any).stderr = "Error: Invalid argument";
      mockExeca.mockRejectedValue(scriptError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running sync.sh..."));
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: Command failed with exit code 2")
      );
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle script that exits with code 127 (command not found)", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\nnonexistent_command",
        },
      });

      const scriptError = new Error("Command failed: nonexistent_command: command not found");
      (scriptError as any).exitCode = 127;
      mockExeca.mockRejectedValue(scriptError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: Command failed: nonexistent_command: command not found")
      );
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle script that succeeds with non-zero but success exit code", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'success with warnings'\nexit 0",
        },
      });

      mockExeca.mockResolvedValue({ 
        stdout: "success with warnings", 
        stderr: "warning: deprecated option used", 
        exitCode: 0 
      });

      await sync();

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running sync.sh..."));
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
      expect(processMock.exit).not.toHaveBeenCalled();
    });
  });

  describe("stdout and stderr capture handling", () => {
    it("should handle scripts that output to stdout", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'Processing files...'\necho 'Sync complete'",
        },
      });

      // Note: With stdio: 'inherit', stdout/stderr go directly to console, not captured
      mockExeca.mockResolvedValue({ 
        stdout: "Processing files...\nSync complete", 
        stderr: "", 
        exitCode: 0 
      });

      await sync();

      // Verify execa was called with stdio: 'inherit' which means output goes directly to console
      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "sync.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
    });

    it("should handle scripts that output to stderr", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'warning message' >&2\nexit 0",
        },
      });

      mockExeca.mockResolvedValue({ 
        stdout: "", 
        stderr: "warning message", 
        exitCode: 0 
      });

      await sync();

      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "sync.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
    });

    it("should handle scripts with mixed stdout and stderr output", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'Starting sync'\necho 'warning' >&2\necho 'Finished'",
        },
      });

      mockExeca.mockResolvedValue({ 
        stdout: "Starting sync\nFinished", 
        stderr: "warning", 
        exitCode: 0 
      });

      await sync();

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
      expect(processMock.exit).not.toHaveBeenCalled();
    });
  });

  describe("permission and execution error handling", () => {
    it("should handle permission denied when executing script", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'test'",
        },
      });

      // Mock execa to reject with permission denied error
      const permissionError = new Error("Permission denied");
      (permissionError as any).code = "EACCES";
      mockExeca.mockRejectedValue(permissionError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: Permission denied")
      );
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle bash command not found error", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'test'",
        },
      });

      const commandError = new Error("bash: command not found");
      (commandError as any).code = "ENOENT";
      mockExeca.mockRejectedValue(commandError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: bash: command not found")
      );
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle file system errors during script execution", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'test'",
        },
      });

      const fsError = new Error("EIO: i/o error, read");
      (fsError as any).code = "EIO";
      mockExeca.mockRejectedValue(fsError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: EIO: i/o error, read")
      );
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("working directory context preservation", () => {
    it("should maintain current working directory after sync execution", async () => {
      const originalCwd = tempDir;
      processMock.cwd.mockReturnValue(originalCwd);

      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\ncd / && echo 'changed directory'",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "changed directory", stderr: "", exitCode: 0 });

      await sync();

      // Verify that the working directory is preserved in the execa call
      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "sync.sh")], {
        stdio: "inherit",
        cwd: originalCwd,
      });

      // The process.cwd() should still return the original directory
      expect(processMock.cwd).toHaveBeenCalled();
    });

    it("should handle scripts that change directory internally", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": `#!/bin/bash
cd subdir
echo "Working in $(pwd)"
cd ..
echo "Back to $(pwd)"`,
        },
        "subdir": {},
      });

      mockExeca.mockResolvedValue({ 
        stdout: `Working in ${tempDir}/subdir\nBack to ${tempDir}`, 
        stderr: "", 
        exitCode: 0 
      });

      await sync();

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "sync.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });
    });

    it("should work correctly when invoked from different working directories", async () => {
      // Create nested directory structure
      const nestedDir = join(tempDir, "nested", "deep");
      await fs.mkdir(nestedDir, { recursive: true });
      
      // Create script in the nested directory
      await createMockFileStructure(nestedDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'nested sync'",
        },
      });

      // Mock cwd to return the nested directory
      processMock.cwd.mockReturnValue(nestedDir);

      mockExeca.mockResolvedValue({ stdout: "nested sync", stderr: "", exitCode: 0 });

      await sync();

      // Should use the nested directory path
      expect(mockExeca).toHaveBeenCalledWith(
        "bash", 
        [join(nestedDir, ".repomirror", "sync.sh")], 
        {
          stdio: "inherit",
          cwd: nestedDir,
        }
      );
    });
  });

  describe("script verification and existence checks", () => {
    it("should verify script exists before execution using fs.access", async () => {
      const fsAccessSpy = vi.spyOn(fs, "access");
      
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'test'",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "test", stderr: "", exitCode: 0 });

      await sync();

      // Verify fs.access was called to check file existence
      expect(fsAccessSpy).toHaveBeenCalledWith(join(tempDir, ".repomirror", "sync.sh"));
      
      fsAccessSpy.mockRestore();
    });

    it("should handle fs.access throwing ENOENT error", async () => {
      const fsAccessSpy = vi.spyOn(fs, "access");
      const enoentError = new Error("ENOENT: no such file or directory");
      (enoentError as any).code = "ENOENT";
      fsAccessSpy.mockRejectedValue(enoentError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.")
      );
      expect(mockExeca).not.toHaveBeenCalled();
      
      fsAccessSpy.mockRestore();
    });

    it("should handle fs.access throwing ENOTDIR error", async () => {
      // Create a file where the .repomirror directory should be
      await fs.writeFile(join(tempDir, ".repomirror"), "not a directory");

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.")
      );
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it("should handle script that exists but is not readable", async () => {
      const fsAccessSpy = vi.spyOn(fs, "access");
      const permissionError = new Error("EACCES: permission denied");
      (permissionError as any).code = "EACCES";
      fsAccessSpy.mockRejectedValue(permissionError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.")
      );
      expect(mockExeca).not.toHaveBeenCalled();
      
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

    it("should handle very large script files", async () => {
      // Create a large script with many lines
      const largeScript = [
        "#!/bin/bash",
        "set -e",
        ...Array(1000).fill(0).map((_, i) => `echo "Line ${i}"`),
        "echo 'Large script completed'"
      ].join("\n");

      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": largeScript,
        },
      });

      mockExeca.mockResolvedValue({ stdout: "Large script completed", stderr: "", exitCode: 0 });

      await sync();

      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "sync.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
    });

    it("should handle scripts with special characters in path", async () => {
      // Test script execution when the path contains special characters
      const specialDir = join(tempDir, "dir with spaces");
      await fs.mkdir(specialDir, { recursive: true });
      
      processMock.cwd.mockReturnValue(specialDir);

      await createMockFileStructure(specialDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'special path sync'",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "special path sync", stderr: "", exitCode: 0 });

      await sync();

      expect(mockExeca).toHaveBeenCalledWith(
        "bash", 
        [join(specialDir, ".repomirror", "sync.sh")], 
        {
          stdio: "inherit",
          cwd: specialDir,
        }
      );
    });

    it("should handle script execution timeout scenarios", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\nsleep 300",
        },
      });

      // Mock a timeout error
      const timeoutError = new Error("Command timed out after 30000 milliseconds");
      (timeoutError as any).timedOut = true;
      mockExeca.mockRejectedValue(timeoutError);

      await expect(sync()).rejects.toThrow("Process exit called with code 1");

      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync failed: Command timed out after 30000 milliseconds")
      );
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle scripts with binary output", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\nprintf '\\x00\\x01\\x02\\x03'",
        },
      });

      // Mock binary output
      mockExeca.mockResolvedValue({ 
        stdout: Buffer.from([0, 1, 2, 3]).toString(), 
        stderr: "", 
        exitCode: 0 
      });

      await sync();

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Sync completed successfully"));
      expect(processMock.exit).not.toHaveBeenCalled();
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