import { vi } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Test utility functions for repomirror tests
 */

/**
 * Create a temporary directory for testing
 */
export async function createTempDir(prefix: string = "repomirror-test-"): Promise<string> {
  const tempPath = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).substring(7)}`);
  await fs.mkdir(tempPath, { recursive: true });
  return tempPath;
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(path: string): Promise<void> {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors in tests
    console.warn(`Failed to cleanup temp directory ${path}:`, error);
  }
}

/**
 * Create a mock git repository in a directory
 */
export async function createMockGitRepo(repoPath: string, withRemote: boolean = true): Promise<void> {
  await fs.mkdir(join(repoPath, ".git"), { recursive: true });
  
  // Create basic git config files
  await fs.writeFile(join(repoPath, ".git", "config"), `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
\tlogallrefupdates = true
${withRemote ? `[remote "origin"]
\turl = https://github.com/test/repo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*` : ''}
`);

  await fs.writeFile(join(repoPath, ".git", "HEAD"), "ref: refs/heads/main\n");
  
  // Create a simple file in the repo
  await fs.writeFile(join(repoPath, "README.md"), "# Test Repository\n");
}

/**
 * Mock console methods for testing
 */
export function mockConsole() {
  const consoleMock = {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
  
  vi.spyOn(console, "log").mockImplementation(consoleMock.log);
  vi.spyOn(console, "error").mockImplementation(consoleMock.error);
  vi.spyOn(console, "warn").mockImplementation(consoleMock.warn);
  vi.spyOn(console, "info").mockImplementation(consoleMock.info);
  
  return consoleMock;
}

/**
 * Mock process methods for testing
 */
export function mockProcess(shouldThrowOnExit: boolean = true) {
  const processMock = {
    exit: shouldThrowOnExit 
      ? vi.fn().mockImplementation((code?: number) => {
          throw new Error(`Process exit called with code ${code}`);
        })
      : vi.fn(),
    cwd: vi.fn(),
  };
  
  vi.spyOn(process, "exit").mockImplementation(processMock.exit as any);
  vi.spyOn(process, "cwd").mockImplementation(processMock.cwd);
  
  return processMock;
}

/**
 * Create a mock file structure
 */
export async function createMockFileStructure(
  basePath: string, 
  structure: Record<string, string | Record<string, any>>
): Promise<void> {
  for (const [name, content] of Object.entries(structure)) {
    const fullPath = join(basePath, name);
    
    if (typeof content === "string") {
      // It's a file
      await fs.mkdir(join(fullPath, ".."), { recursive: true });
      await fs.writeFile(fullPath, content);
    } else {
      // It's a directory
      await fs.mkdir(fullPath, { recursive: true });
      await createMockFileStructure(fullPath, content);
    }
  }
}

/**
 * Wait for a specified amount of time (for async tests)
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mock inquirer prompts for testing
 */
export function mockInquirer(responses: Record<string, any>) {
  return {
    prompt: vi.fn().mockResolvedValue(responses)
  };
}

/**
 * Mock ora spinner for testing
 */
export function mockOra() {
  const spinnerMock = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  };
  
  return vi.fn().mockReturnValue(spinnerMock);
}

/**
 * Mock execa for command execution testing
 */
export function mockExeca(responses: Record<string, { stdout?: string; stderr?: string; exitCode?: number }> = {}) {
  return vi.fn().mockImplementation((command: string, args: string[] = []) => {
    const fullCommand = `${command} ${args.join(" ")}`.trim();
    const response = responses[fullCommand] || responses[command] || { stdout: "", exitCode: 0 };
    
    if (response.exitCode && response.exitCode !== 0) {
      const error = new Error(`Command failed: ${fullCommand}`) as any;
      error.exitCode = response.exitCode;
      error.stderr = response.stderr || "";
      throw error;
    }
    
    return Promise.resolve({
      stdout: response.stdout || "",
      stderr: response.stderr || "",
      exitCode: response.exitCode || 0,
    });
  });
}