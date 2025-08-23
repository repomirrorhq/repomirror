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
        ".repomirror": {
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
});