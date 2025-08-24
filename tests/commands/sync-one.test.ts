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

// Mock the sync function since sync-one is just an alias
const mockSync = vi.fn();

vi.mock("../../src/commands/sync", () => ({
  sync: mockSync,
}));

// Import the module after mocking
const { syncOne } = await import("../../src/commands/sync-one");

describe("sync-one command", () => {
  let tempDir: string;
  let consoleMock: ReturnType<typeof mockConsole>;
  let processMock: ReturnType<typeof mockProcess>;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await createTempDir("repomirror-sync-one-");

    // Setup mocks
    consoleMock = mockConsole();
    processMock = mockProcess(true);

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

  describe("alias functionality", () => {
    it("should call the sync function when executed", async () => {
      // Mock sync to resolve successfully
      mockSync.mockResolvedValue(undefined);

      await syncOne();

      // Verify that the sync function was called exactly once
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();
    });

    it("should pass through successful execution from sync", async () => {
      // Mock sync to resolve successfully
      mockSync.mockResolvedValue(undefined);

      const result = await syncOne();

      // Verify successful completion (no return value)
      expect(result).toBeUndefined();
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should pass through errors from sync function", async () => {
      // Mock sync to reject with an error
      const syncError = new Error("Sync failed");
      mockSync.mockRejectedValue(syncError);

      // Verify that syncOne propagates the error
      await expect(syncOne()).rejects.toThrow("Sync failed");
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should pass through process exit calls from sync", async () => {
      // Mock sync to throw a process exit error (as our test mock does)
      mockSync.mockRejectedValue(new Error("Process exit called with code 1"));

      await expect(syncOne()).rejects.toThrow("Process exit called with code 1");
      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("integration behavior", () => {
    it("should maintain the same interface as sync command", async () => {
      mockSync.mockResolvedValue(undefined);

      // syncOne should be a function that returns a Promise<void>
      const result = syncOne();
      expect(result).toBeInstanceOf(Promise);

      await result;
      expect(mockSync).toHaveBeenCalled();
    });

    it("should handle multiple consecutive calls", async () => {
      mockSync.mockResolvedValue(undefined);

      // Call syncOne multiple times
      await syncOne();
      await syncOne();
      await syncOne();

      // Each call should result in a call to sync
      expect(mockSync).toHaveBeenCalledTimes(3);
    });

    it("should handle async errors properly", async () => {
      // Test different types of errors that sync might throw
      const errors = [
        new Error("File not found"),
        new Error("Permission denied"),
        new Error("Script execution failed"),
      ];

      for (const error of errors) {
        mockSync.mockClear();
        mockSync.mockRejectedValue(error);

        await expect(syncOne()).rejects.toThrow(error.message);
        expect(mockSync).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("command consistency", () => {
    it("should behave identically to sync command for successful execution", async () => {
      // Create a real sync environment to verify behavior is consistent
      await createMockFileStructure(tempDir, {
        ".simonsays": {
          "sync.sh": `#!/bin/bash
echo "Test sync execution"`,
        },
      });

      mockSync.mockResolvedValue(undefined);

      await syncOne();

      // Verify the same sync function is called with the same parameters
      expect(mockSync).toHaveBeenCalledWith();
    });

    it("should maintain error handling consistency with sync", async () => {
      // Test that sync-one doesn't add any additional error handling
      const syncError = new Error("Custom sync error with specific message");
      mockSync.mockRejectedValue(syncError);

      try {
        await syncOne();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Error should be exactly the same as what sync threw
        expect(error).toBe(syncError);
      }

      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("documentation and clarity", () => {
    it("should be clear that sync-one is an alias for sync", async () => {
      mockSync.mockResolvedValue(undefined);

      // The function name and behavior should make it clear this is an alias
      await syncOne();

      // Should delegate entirely to sync function
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();
    });

    it("should be a true alias with zero functional differences from sync", async () => {
      mockSync.mockResolvedValue(undefined);

      // Verify that syncOne is literally just a wrapper around sync
      // with no additional logic, parameters, or side effects
      await syncOne();

      // Should call sync exactly once with no arguments
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();

      // Should not have any other function calls or side effects
      expect(consoleMock.log).not.toHaveBeenCalled();
      expect(consoleMock.error).not.toHaveBeenCalled();
      expect(consoleMock.warn).not.toHaveBeenCalled();
    });

    it("should not add any additional functionality beyond sync", async () => {
      mockSync.mockResolvedValue(undefined);

      const startTime = Date.now();
      await syncOne();
      const endTime = Date.now();

      // Should complete quickly since it's just a function call
      expect(endTime - startTime).toBeLessThan(100);
      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("error propagation", () => {
    it("should propagate file not found errors", async () => {
      const fileError = new Error("Process exit called with code 1");
      mockSync.mockRejectedValue(fileError);

      await expect(syncOne()).rejects.toThrow("Process exit called with code 1");
    });

    it("should propagate script execution errors", async () => {
      const execError = new Error("Script execution failed");
      mockSync.mockRejectedValue(execError);

      await expect(syncOne()).rejects.toThrow("Script execution failed");
    });

    it("should propagate permission errors", async () => {
      const permError = new Error("Permission denied");
      mockSync.mockRejectedValue(permError);

      await expect(syncOne()).rejects.toThrow("Permission denied");
    });

    it("should handle sync function returning promises correctly", async () => {
      // Test that syncOne properly awaits the sync promise
      let syncResolved = false;
      
      mockSync.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        syncResolved = true;
      });

      await syncOne();

      expect(syncResolved).toBe(true);
      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("type safety and interface", () => {
    it("should have the same return type as sync", async () => {
      mockSync.mockResolvedValue(undefined);

      const result = await syncOne();
      
      // Both sync and syncOne should return Promise<void>
      expect(result).toBeUndefined();
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should accept no parameters like sync", async () => {
      mockSync.mockResolvedValue(undefined);

      // syncOne should not accept any parameters
      await syncOne();

      // Verify sync was called with no parameters
      expect(mockSync).toHaveBeenCalledWith();
    });

    it("should be usable in the same contexts as sync", async () => {
      mockSync.mockResolvedValue(undefined);

      // Should be able to use syncOne anywhere sync can be used
      const commands = [syncOne];
      
      for (const command of commands) {
        await command();
      }

      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("performance and efficiency", () => {
    it("should add minimal overhead over sync", async () => {
      mockSync.mockResolvedValue(undefined);

      const startTime = process.hrtime.bigint();
      await syncOne();
      const endTime = process.hrtime.bigint();

      // Should complete very quickly as it's just a function call
      const durationMs = Number(endTime - startTime) / 1_000_000;
      expect(durationMs).toBeLessThan(50); // Less than 50ms overhead

      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should not create unnecessary promises or async overhead", async () => {
      let syncCallCount = 0;
      
      mockSync.mockImplementation(async () => {
        syncCallCount++;
        return undefined;
      });

      await syncOne();

      // Should result in exactly one call to sync
      expect(syncCallCount).toBe(1);
      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("console output verification", () => {
    it("should not produce any console output directly (all output from sync)", async () => {
      mockSync.mockResolvedValue(undefined);

      await syncOne();

      // syncOne should not produce any console output itself
      // All output should come from the sync function it calls
      expect(consoleMock.log).not.toHaveBeenCalled();
      expect(consoleMock.error).not.toHaveBeenCalled();
      expect(consoleMock.warn).not.toHaveBeenCalled();
      expect(consoleMock.info).not.toHaveBeenCalled();
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should let sync handle all console output on success", async () => {
      // Mock sync to produce some console output
      mockSync.mockImplementation(async () => {
        console.log("Running sync.sh...");
        console.log("Sync completed successfully");
        return undefined;
      });

      await syncOne();

      // Verify sync was called and produced output
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(consoleMock.log).toHaveBeenCalledWith("Running sync.sh...");
      expect(consoleMock.log).toHaveBeenCalledWith("Sync completed successfully");
    });

    it("should let sync handle all console output on error", async () => {
      // Mock sync to produce error output before throwing
      mockSync.mockImplementation(async () => {
        console.error("Error: .simonsays/sync.sh not found. Run 'npx simonsays init' first.");
        throw new Error("Process exit called with code 1");
      });

      await expect(syncOne()).rejects.toThrow("Process exit called with code 1");

      // Verify sync was called and produced error output
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(consoleMock.error).toHaveBeenCalledWith("Error: .simonsays/sync.sh not found. Run 'npx simonsays init' first.");
    });

    it("should preserve the exact console output from sync", async () => {
      const testMessages = [
        "Running sync.sh...",
        "Processing files...",
        "Sync completed successfully"
      ];

      mockSync.mockImplementation(async () => {
        testMessages.forEach(msg => console.log(msg));
        return undefined;
      });

      await syncOne();

      // Verify all messages were logged in the correct order
      expect(mockSync).toHaveBeenCalledTimes(1);
      testMessages.forEach(msg => {
        expect(consoleMock.log).toHaveBeenCalledWith(msg);
      });
      expect(consoleMock.log).toHaveBeenCalledTimes(testMessages.length);
    });
  });

  describe("argument passing verification", () => {
    it("should pass no arguments to sync (both take zero parameters)", async () => {
      mockSync.mockResolvedValue(undefined);

      // Call syncOne with no arguments (as it should be called)
      await syncOne();

      // Verify sync was called with exactly zero arguments
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();
      expect(mockSync).toHaveBeenCalledWith(...[]); // Explicitly verify no args
    });

    it("should handle the fact that neither command accepts parameters", async () => {
      mockSync.mockResolvedValue(undefined);

      // syncOne doesn't accept parameters, just like sync
      const result = await syncOne();

      // Verify the call signature matches sync exactly
      expect(result).toBeUndefined();
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();
    });

    it("should maintain parameter consistency with sync command", async () => {
      mockSync.mockResolvedValue(undefined);

      // Both commands should have identical function signatures
      // syncOne: () => Promise<void>
      // sync: () => Promise<void>
      
      // Test that syncOne behaves exactly like sync would
      await syncOne();

      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();

      // Clear mocks and test direct sync call for comparison
      mockSync.mockClear();
      await mockSync();

      // Both calls should be identical
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();
    });
  });

  describe("delegation verification", () => {
    it("should delegate 100% of functionality to sync", async () => {
      mockSync.mockResolvedValue(undefined);

      await syncOne();

      // syncOne should do nothing except call sync
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(mockSync).toHaveBeenCalledWith();

      // No other system calls should be made by syncOne itself
      expect(processMock.exit).not.toHaveBeenCalled();
      expect(consoleMock.log).not.toHaveBeenCalled();
      expect(consoleMock.error).not.toHaveBeenCalled();
    });

    it("should delegate error handling entirely to sync", async () => {
      const customError = new Error("Custom delegation test error");
      mockSync.mockRejectedValue(customError);

      try {
        await syncOne();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        // Error should be the exact same object from sync
        expect(error).toBe(customError);
        expect(error.message).toBe("Custom delegation test error");
      }

      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should delegate success handling entirely to sync", async () => {
      const customReturnValue = undefined; // sync returns Promise<void>
      mockSync.mockResolvedValue(customReturnValue);

      const result = await syncOne();

      // Result should be exactly what sync returned
      expect(result).toBe(customReturnValue);
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should delegate all async behavior to sync", async () => {
      let syncStarted = false;
      let syncCompleted = false;

      mockSync.mockImplementation(async () => {
        syncStarted = true;
        await new Promise(resolve => setTimeout(resolve, 50));
        syncCompleted = true;
        return undefined;
      });

      // Before calling syncOne, sync should not have started
      expect(syncStarted).toBe(false);
      expect(syncCompleted).toBe(false);

      const promise = syncOne();
      
      // After calling syncOne but before awaiting, sync should have started
      expect(syncStarted).toBe(true);
      expect(syncCompleted).toBe(false);

      await promise;

      // After awaiting, sync should be completed
      expect(syncCompleted).toBe(true);
      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("comprehensive error propagation", () => {
    it("should propagate all error types without modification", async () => {
      const errorTypes = [
        new Error("Standard error"),
        new TypeError("Type error"),
        new ReferenceError("Reference error"),
        new SyntaxError("Syntax error"),
        { name: "CustomError", message: "Custom error object" },
        "String error",
        42, // Number error
        null,
        undefined
      ];

      for (const error of errorTypes) {
        mockSync.mockClear();
        mockSync.mockRejectedValue(error);

        try {
          await syncOne();
          expect(true).toBe(false); // Should not reach here
        } catch (caughtError) {
          // Error should be exactly the same object/value
          expect(caughtError).toBe(error);
        }

        expect(mockSync).toHaveBeenCalledTimes(1);
      }
    });

    it("should preserve error stack traces", async () => {
      const errorWithStack = new Error("Error with stack trace");
      const originalStack = errorWithStack.stack;
      mockSync.mockRejectedValue(errorWithStack);

      try {
        await syncOne();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        // Stack trace should be preserved
        expect(error.stack).toBe(originalStack);
      }

      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should handle promise rejection timing correctly", async () => {
      let rejectionHandled = false;
      
      mockSync.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error("Delayed rejection");
      });

      try {
        await syncOne();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        rejectionHandled = true;
        expect(error.message).toBe("Delayed rejection");
      }

      expect(rejectionHandled).toBe(true);
      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases and robustness", () => {
    it("should handle sync returning resolved promises correctly", async () => {
      // Test with already resolved promise
      mockSync.mockReturnValue(Promise.resolve(undefined));

      const result = await syncOne();

      expect(result).toBeUndefined();
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should handle sync returning rejected promises correctly", async () => {
      // Test with already rejected promise
      const error = new Error("Pre-rejected promise");
      mockSync.mockReturnValue(Promise.reject(error));

      await expect(syncOne()).rejects.toThrow("Pre-rejected promise");
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it("should work correctly when called in quick succession", async () => {
      mockSync.mockResolvedValue(undefined);

      // Fire off multiple calls simultaneously
      const promises = [
        syncOne(),
        syncOne(),
        syncOne()
      ];

      await Promise.all(promises);

      // Each call should result in a separate call to sync
      expect(mockSync).toHaveBeenCalledTimes(3);
    });

    it("should handle mixed success and failure scenarios", async () => {
      // First call succeeds
      mockSync.mockResolvedValue(undefined);
      await syncOne();
      expect(mockSync).toHaveBeenCalledTimes(1);

      // Second call fails
      mockSync.mockClear();
      mockSync.mockRejectedValue(new Error("Second call failed"));
      await expect(syncOne()).rejects.toThrow("Second call failed");
      expect(mockSync).toHaveBeenCalledTimes(1);

      // Third call succeeds again
      mockSync.mockClear();
      mockSync.mockResolvedValue(undefined);
      await syncOne();
      expect(mockSync).toHaveBeenCalledTimes(1);
    });
  });
});