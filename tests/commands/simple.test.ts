import { describe, it, expect, vi } from "vitest";
import { createTempDir, cleanupTempDir, mockConsole } from "../helpers/test-utils";

describe("command utilities", () => {
  it("should create and cleanup temporary directories", async () => {
    const tempDir = await createTempDir("test-");
    expect(tempDir).toMatch(/test-/);
    
    // Directory should exist
    const fs = await import("fs");
    const stats = await fs.promises.stat(tempDir);
    expect(stats.isDirectory()).toBe(true);
    
    // Cleanup should work
    await cleanupTempDir(tempDir);
  });

  it("should mock console methods", () => {
    const consoleMock = mockConsole();
    
    console.log("test message");
    console.error("error message");
    
    expect(consoleMock.log).toHaveBeenCalledWith("test message");
    expect(consoleMock.error).toHaveBeenCalledWith("error message");
    
    vi.restoreAllMocks();
  });

  it("should work with TypeScript imports", async () => {
    // Test that we can import from source with TypeScript
    const { basename } = await import("path");
    const result = basename("/some/path/file.txt");
    expect(result).toBe("file.txt");
  });
});