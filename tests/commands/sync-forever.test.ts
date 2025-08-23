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
const { syncForever } = await import("../../src/commands/sync-forever");

describe("sync-forever command", () => {
  let tempDir: string;
  let consoleMock: ReturnType<typeof mockConsole>;
  let processMock: ReturnType<typeof mockProcess>;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await createTempDir("repomirror-sync-forever-");

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
    it("should execute ralph.sh successfully when script exists", async () => {
      // Create .repomirror directory and ralph.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": `#!/bin/bash
while :; do
  ./.repomirror/sync.sh
  echo -e "===SLEEP===\\n===SLEEP===\\n"; echo 'looping';
  sleep 10;
done`,
        },
      });

      // Mock successful execa execution
      mockExeca.mockResolvedValue({
        stdout: "Continuous sync running",
        stderr: "",
        exitCode: 0,
      });

      // Run syncForever
      await syncForever();

      // Verify execa was called with correct parameters
      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "ralph.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });

      // Verify console output
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running ralph.sh (continuous sync)..."));
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Press Ctrl+C to stop"));

      // Verify process.exit was not called (successful execution)
      expect(processMock.exit).not.toHaveBeenCalled();
    });

    it("should use correct working directory and script path", async () => {
      // Create .repomirror directory and ralph.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\necho 'continuous sync'",
        },
      });

      // Mock successful execa execution
      mockExeca.mockResolvedValue({
        stdout: "continuous sync",
        stderr: "",
        exitCode: 0,
      });

      await syncForever();

      const expectedScriptPath = join(tempDir, ".repomirror", "ralph.sh");

      // Verify execa was called with absolute path to ralph.sh
      expect(mockExeca).toHaveBeenCalledWith("bash", [expectedScriptPath], {
        stdio: "inherit",
        cwd: tempDir,
      });
    });

    it("should inherit stdio for continuous output monitoring", async () => {
      // Create .repomirror directory and ralph.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\nwhile true; do echo 'continuous'; sleep 1; done",
        },
      });

      mockExeca.mockResolvedValue({
        stdout: "continuous",
        stderr: "",
        exitCode: 0,
      });

      await syncForever();

      // Verify stdio: "inherit" was passed to execa for real-time output
      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        [join(tempDir, ".repomirror", "ralph.sh")],
        expect.objectContaining({
          stdio: "inherit",
        })
      );
    });
  });

  describe("error cases", () => {
    it("should exit with error when .repomirror/ralph.sh does not exist", async () => {
      // Don't create the ralph.sh script

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Verify error message
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/ralph.sh not found. Run 'npx repomirror init' first.")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);

      // Verify execa was not called
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it("should exit with error when .repomirror directory does not exist", async () => {
      // Don't create the .repomirror directory at all

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Verify error message
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/ralph.sh not found. Run 'npx repomirror init' first.")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);

      // Verify execa was not called
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it("should handle script execution errors gracefully", async () => {
      // Create .repomirror directory and ralph.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\nexit 1",
        },
      });

      // Mock failed execa execution
      const scriptError = new Error("Ralph script execution failed");
      (scriptError as any).exitCode = 1;
      mockExeca.mockRejectedValue(scriptError);

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Verify initial success messages
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running ralph.sh (continuous sync)..."));
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Press Ctrl+C to stop"));

      // Verify error message
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync forever failed: Ralph script execution failed")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle non-Error exceptions in script execution", async () => {
      // Create .repomirror directory and ralph.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\necho 'failing'",
        },
      });

      // Mock execa to throw a non-Error object
      mockExeca.mockRejectedValue("String error in ralph");

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Verify error message handles non-Error exceptions
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync forever failed: String error in ralph")
      );

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("SIGINT signal handling", () => {
    it("should handle SIGINT gracefully with user-friendly message", async () => {
      // Create .repomirror directory and ralph.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": `#!/bin/bash
trap 'exit 0' SIGINT
while true; do
  echo "Running..."
  sleep 1
done`,
        },
      });

      // Mock execa to simulate SIGINT (Ctrl+C)
      const sigintError = new Error("Process interrupted");
      (sigintError as any).signal = "SIGINT";
      mockExeca.mockRejectedValue(sigintError);

      // Should not throw or exit - SIGINT is handled gracefully
      await syncForever();

      // Verify user-friendly stop message
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Stopped by user"));

      // Verify process.exit was NOT called (graceful shutdown)
      expect(processMock.exit).not.toHaveBeenCalled();
    });

    it("should distinguish SIGINT from other errors", async () => {
      // Create .repomirror directory and ralph.sh script
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\necho 'running'",
        },
      });

      // Mock execa to simulate a non-SIGINT error
      const otherError = new Error("Network error");
      (otherError as any).signal = "SIGTERM";
      mockExeca.mockRejectedValue(otherError);

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Should show error message, not the user-friendly stop message
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync forever failed: Network error")
      );
      expect(consoleMock.log).not.toHaveBeenCalledWith(expect.stringContaining("Stopped by user"));

      // Verify process.exit was called with code 1
      expect(processMock.exit).toHaveBeenCalledWith(1);
    });

    it("should handle Error objects with SIGINT signal correctly", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\ntrap 'exit 0' SIGINT; sleep 1000",
        },
      });

      // Create proper Error object with SIGINT signal
      const sigintError = new Error("Command was killed with SIGINT");
      (sigintError as any).signal = "SIGINT";
      mockExeca.mockRejectedValue(sigintError);

      // Should complete without throwing
      await syncForever();

      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Stopped by user"));
      expect(processMock.exit).not.toHaveBeenCalled();
    });

    it("should handle non-Error objects with SIGINT signal", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\necho 'test'",
        },
      });

      // Mock with non-Error object that has signal property
      const sigintObj = { signal: "SIGINT", message: "Interrupted" };
      mockExeca.mockRejectedValue(sigintObj);

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Non-Error objects should be treated as regular errors
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync forever failed:")
      );
      expect(consoleMock.log).not.toHaveBeenCalledWith(expect.stringContaining("Stopped by user"));
    });
  });

  describe("console output verification", () => {
    beforeEach(async () => {
      // Create .repomirror directory and ralph.sh script for all output tests
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": `#!/bin/bash
echo "Continuous sync"
while true; do sleep 1; done`,
        },
      });
    });

    it("should show cyan colored startup messages", async () => {
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await syncForever();

      // Check that the startup messages were logged
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running ralph.sh (continuous sync)..."));
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Press Ctrl+C to stop"));
    });

    it("should show yellow colored stop message on SIGINT", async () => {
      const sigintError = new Error("Interrupted");
      (sigintError as any).signal = "SIGINT";
      mockExeca.mockRejectedValue(sigintError);

      await syncForever();

      // Check that the stop message was logged in yellow
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Stopped by user"));
    });

    it("should show red colored error message on failure", async () => {
      const error = new Error("Command failed");
      mockExeca.mockRejectedValue(error);

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Check that the error message was logged
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Sync forever failed: Command failed")
      );
    });

    it("should show red colored error message when ralph.sh is missing", async () => {
      // Remove the ralph.sh script
      await fs.rm(join(tempDir, ".repomirror", "ralph.sh"));

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Check that the missing file error message was logged
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/ralph.sh not found. Run 'npx repomirror init' first.")
      );
    });
  });

  describe("file system access patterns", () => {
    it("should use fs.access to check ralph.sh existence", async () => {
      const fsAccessSpy = vi.spyOn(fs, "access");

      // Create the script so access check passes
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\necho 'continuous'",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await syncForever();

      // Verify fs.access was called with the correct path
      expect(fsAccessSpy).toHaveBeenCalledWith(join(tempDir, ".repomirror", "ralph.sh"));

      fsAccessSpy.mockRestore();
    });

    it("should handle permission denied errors on file access", async () => {
      const fsAccessSpy = vi.spyOn(fs, "access");
      fsAccessSpy.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Verify the error message still shows file not found (since we catch all access errors)
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/ralph.sh not found. Run 'npx repomirror init' first.")
      );

      fsAccessSpy.mockRestore();
    });
  });

  describe("continuous execution scenarios", () => {
    it("should handle long-running scripts appropriately", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": `#!/bin/bash
while true; do
  echo "Syncing..."
  sleep 5
done`,
        },
      });

      // Mock long-running process that eventually completes
      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await syncForever();

      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "ralph.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });
    });

    it("should handle scripts with complex loop logic", async () => {
      const complexScript = `#!/bin/bash
set -euo pipefail

cleanup() {
    echo "Cleaning up..."
    exit 0
}

trap cleanup SIGINT SIGTERM

while :; do
    echo "Starting sync cycle..."
    
    # Run sync
    if ./.repomirror/sync.sh; then
        echo "Sync successful"
    else
        echo "Sync failed, continuing anyway..."
    fi
    
    echo -e "===SLEEP===\\n===SLEEP===\\n"
    echo 'Waiting before next cycle...'
    sleep 10
done`;

      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": complexScript,
        },
      });

      mockExeca.mockResolvedValue({ stdout: "Complex script output", stderr: "", exitCode: 0 });

      await syncForever();

      // Should execute the complex script successfully
      expect(mockExeca).toHaveBeenCalledWith("bash", [join(tempDir, ".repomirror", "ralph.sh")], {
        stdio: "inherit",
        cwd: tempDir,
      });
    });

    it("should handle empty script content", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await syncForever();

      // Should still execute successfully
      expect(mockExeca).toHaveBeenCalled();
    });
  });

  describe("process and signal handling edge cases", () => {
    it("should preserve working directory context for continuous execution", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\npwd; while true; do sleep 1; done",
        },
      });

      mockExeca.mockResolvedValue({ stdout: tempDir, stderr: "", exitCode: 0 });

      await syncForever();

      // Verify that execa is called with the correct working directory
      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        [join(tempDir, ".repomirror", "ralph.sh")],
        expect.objectContaining({
          cwd: tempDir,
        })
      );
    });

    it("should handle bash command execution with proper shell for continuous processes", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\necho 'continuous execution'; while true; do sleep 1; done",
        },
      });

      mockExeca.mockResolvedValue({ stdout: "continuous execution", stderr: "", exitCode: 0 });

      await syncForever();

      // Verify that bash is used as the shell command
      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        expect.any(Array),
        expect.any(Object)
      );
    });

    it("should handle multiple different signal types correctly", async () => {
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\nwhile true; do sleep 1; done",
        },
      });

      // Test different signals
      const signals = ["SIGTERM", "SIGKILL", "SIGHUP", "SIGQUIT"];
      
      for (const signal of signals) {
        mockExeca.mockClear();
        const error = new Error(`Process killed with ${signal}`);
        (error as any).signal = signal;
        mockExeca.mockRejectedValue(error);

        await expect(syncForever()).rejects.toThrow("Process exit called with code 1");
        
        // Only SIGINT should show the user-friendly message
        expect(consoleMock.error).toHaveBeenCalledWith(
          expect.stringContaining(`Sync forever failed: Process killed with ${signal}`)
        );
      }
    });
  });

  describe("ralph.sh specific behavior", () => {
    it("should specifically look for ralph.sh not sync.sh", async () => {
      // Create only sync.sh, not ralph.sh
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "sync.sh": "#!/bin/bash\necho 'sync'",
        },
      });

      await expect(syncForever()).rejects.toThrow("Process exit called with code 1");

      // Should specifically complain about ralph.sh being missing
      expect(consoleMock.error).toHaveBeenCalledWith(
        expect.stringContaining("Error: .repomirror/ralph.sh not found.")
      );
    });

    it("should execute ralph.sh with appropriate permissions expectations", async () => {
      // Create ralph.sh with executable permissions
      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": "#!/bin/bash\necho 'ralph running'",
        },
      });

      // Make script executable (simulate proper init)
      const scriptPath = join(tempDir, ".repomirror", "ralph.sh");
      const stats = await fs.stat(scriptPath);
      await fs.chmod(scriptPath, stats.mode | 0o111);

      mockExeca.mockResolvedValue({ stdout: "ralph running", stderr: "", exitCode: 0 });

      await syncForever();

      expect(mockExeca).toHaveBeenCalledWith("bash", [scriptPath], {
        stdio: "inherit",
        cwd: tempDir,
      });
    });

    it("should work with ralph.sh that contains typical continuous sync logic", async () => {
      const typicalRalphScript = `#!/bin/bash
while :; do
  ./.repomirror/sync.sh
  echo -e "===SLEEP===\\n===SLEEP===\\n"; echo 'looping';
  sleep 10;
done`;

      await createMockFileStructure(tempDir, {
        ".repomirror": {
          "ralph.sh": typicalRalphScript,
        },
      });

      mockExeca.mockResolvedValue({ stdout: "Typical ralph execution", stderr: "", exitCode: 0 });

      await syncForever();

      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        [join(tempDir, ".repomirror", "ralph.sh")],
        {
          stdio: "inherit",
          cwd: tempDir,
        }
      );
      
      expect(consoleMock.log).toHaveBeenCalledWith(expect.stringContaining("Running ralph.sh (continuous sync)..."));
    });
  });
});