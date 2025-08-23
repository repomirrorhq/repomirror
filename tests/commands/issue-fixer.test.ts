import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { issueFixer } from "../../src/commands/issue-fixer";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import * as claudeSDK from "@anthropic-ai/claude-code";

// Mock modules
vi.mock("fs");
vi.mock("child_process");
vi.mock("@anthropic-ai/claude-code");

describe("issue-fixer command", () => {
  const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const mockProcessCwd = vi.spyOn(process, "cwd");
  const mockProcessChdir = vi.spyOn(process, "chdir").mockImplementation(() => {});

  const testConfig = `sourceRepo: "./src"
targetRepo: "../myproject-ts"
transformationInstructions: "convert python to typescript"`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessCwd.mockReturnValue("/test/dir");
    
    // Set NODE_ENV to test to avoid process.exit
    process.env.NODE_ENV = "test";
    
    // Default mock for existsSync
    vi.mocked(existsSync).mockImplementation((path) => {
      if (path.toString().includes("repomirror.yaml")) return true;
      if (path.toString().includes("package.json")) return true;
      return false;
    });
    
    // Default mock for readFileSync
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (path.toString().includes("repomirror.yaml")) return testConfig;
      if (path.toString().includes("package.json")) {
        return JSON.stringify({
          name: "test-project",
          scripts: {
            build: "tsc",
            test: "vitest",
            lint: "eslint .",
            typecheck: "tsc --noEmit",
          },
        });
      }
      return "";
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  describe("configuration validation", () => {
    it("should error if repomirror.yaml doesn't exist", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await expect(issueFixer()).rejects.toThrow("process.exit");
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("repomirror.yaml not found")
      );
    });

    it("should error if repomirror.yaml is invalid", async () => {
      vi.mocked(readFileSync).mockReturnValue("invalid: yaml");

      await expect(issueFixer()).rejects.toThrow("process.exit");
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Invalid repomirror.yaml configuration")
      );
    });

    it("should read configuration successfully", async () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));
      
      await issueFixer();
      
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Source: ./src")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Target: ../myproject-ts")
      );
    });
  });

  describe("issue detection", () => {
    it("should detect build issues in Node projects", async () => {
      const buildError = `src/index.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.

10     const x: number = "hello";
           ~

Found 1 error.`;

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          const error = new Error("Build failed") as any;
          error.stdout = Buffer.from(buildError);
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK to avoid actual API calls
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ targetOnly: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Found")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("issue(s)")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("[build]")
      );
    });

    it("should detect test failures", async () => {
      const testError = `✕ should add numbers correctly
✕ should handle edge cases`;

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm test")) {
          const error = new Error("Tests failed") as any;
          error.stdout = Buffer.from(testError);
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ category: "test" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Found 2 issue(s)")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("[test]")
      );
    });

    it("should detect linting issues", async () => {
      const lintError = `src/utils.ts:5:10 error: Unexpected console statement`;

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run lint")) {
          const error = new Error("Lint failed") as any;
          error.stdout = Buffer.from(lintError);
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ category: "lint" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Found 1 issue(s)")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("[lint]")
      );
    });

    it("should detect type checking issues", async () => {
      const typeError = `src/types.ts:15:8 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`;

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run typecheck")) {
          const error = new Error("Type check failed") as any;
          error.stdout = Buffer.from(typeError);
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ category: "type" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Found 1 issue(s)")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("[type]")
      );
    });

    it("should detect missing dependencies", async () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm ls")) {
          const error = new Error("Missing deps") as any;
          error.stdout = Buffer.from("missing: express@^4.0.0");
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ category: "build" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Missing npm dependencies")
      );
    });

    it("should handle Python projects", async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (path.toString().includes("repomirror.yaml")) return true;
        if (path.toString().includes("requirements.txt")) return true;
        return false;
      });

      const ruffError = `src/main.py:10:5: F401 'os' imported but unused`;

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("ruff check")) {
          const error = new Error("Ruff failed") as any;
          error.stdout = Buffer.from(ruffError);
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ category: "lint" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("[lint]")
      );
    });

    it("should handle Go projects", async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (path.toString().includes("repomirror.yaml")) return true;
        if (path.toString().includes("go.mod")) return true;
        return false;
      });

      const goError = `# example.com/myproject
./main.go:15:10: undefined: someFunction
./main.go:20:5: cannot use x (type string) as type int`;

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("go build")) {
          const error = new Error("Go build failed") as any;
          error.stdout = Buffer.from("");
          error.stderr = Buffer.from(goError);
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ category: "build" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Found")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("[build]")
      );
    });

    it("should report no issues when everything passes", async () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));

      await issueFixer();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("No issues detected!")
      );
    });

    it("should filter by category", async () => {
      const buildError = "build error";
      const testError = "test error";

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          const error = new Error("Build failed") as any;
          error.stdout = Buffer.from(buildError);
          throw error;
        }
        if (cmd.toString().includes("npm test")) {
          const error = new Error("Test failed") as any;
          error.stdout = Buffer.from(testError);
          throw error;
        }
        return Buffer.from("");
      });

      // Mock Claude SDK
      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ category: "build" });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("[build]")
      );
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining("[test]")
      );
    });
  });

  describe("issue fixing with Claude", () => {
    it("should call Claude SDK to fix issues", async () => {
      const buildError = "src/index.ts:10:5 - error TS2322";

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          const error = new Error("Build failed") as any;
          error.stdout = Buffer.from(buildError);
          throw error;
        }
        return Buffer.from("");
      });

      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed the type error by correcting the variable assignment.",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("fix issues"),
        })
      );

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Issues have been addressed!")
      );
    });

    it("should handle Claude SDK errors", async () => {
      const buildError = "build error";

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          const error = new Error("Build failed") as any;
          error.stdout = Buffer.from(buildError);
          throw error;
        }
        return Buffer.from("");
      });

      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "API error occurred",
          is_error: true,
        } as any;
      });

      await expect(issueFixer()).rejects.toThrow("API error occurred");
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error from Claude")
      );
    });

    it("should save prompt and response for debugging", async () => {
      const buildError = "build error";
      let savedPrompt = "";
      let savedResponse = "";

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          const error = new Error("Build failed") as any;
          error.stdout = Buffer.from(buildError);
          throw error;
        }
        return Buffer.from("");
      });

      vi.mocked(writeFileSync).mockImplementation((path, content) => {
        if (path.toString().includes("issue-fixer-prompt.md")) {
          savedPrompt = content.toString();
        }
        if (path.toString().includes("issue-fixer-response.md")) {
          savedResponse = content.toString();
        }
      });

      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed the issues",
          is_error: false,
        } as any;
      });

      await issueFixer();

      expect(savedPrompt).toContain("fix issues");
      expect(savedResponse).toBe("Fixed the issues");
    });

    it("should verify fixes after applying them", async () => {
      let fixApplied = false;

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          if (!fixApplied) {
            const error = new Error("Build failed") as any;
            error.stdout = Buffer.from("build error");
            throw error;
          }
          // After fix, no error
          return Buffer.from("");
        }
        return Buffer.from("");
      });

      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        fixApplied = true;
        yield {
          type: "result",
          result: "Fixed",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("All issues have been successfully fixed!")
      );
    });
  });

  describe("interactive mode", () => {
    it.skip("should prompt user for issue selection in interactive mode", async () => {
      const buildError = "error 1\nerror 2";
      
      // Mock readline module at the top level
      const mockReadline = {
        createInterface: vi.fn().mockReturnValue({
          question: vi.fn().mockImplementation((question, callback) => {
            // Immediately call callback with user input
            callback("1");
          }),
          close: vi.fn(),
        }),
      };
      
      // Mock require to return our mock readline
      vi.stubGlobal('require', vi.fn((moduleName) => {
        if (moduleName === 'readline') {
          return mockReadline;
        }
        return {};
      }));

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          const error = new Error("Build failed") as any;
          error.stdout = Buffer.from(buildError);
          throw error;
        }
        return Buffer.from("");
      });

      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed selected issue",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ interactive: true });

      expect(mockReadline.createInterface).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Issues have been addressed!")
      );

      vi.unstubAllGlobals();
    });

    it.skip("should fix all issues when 'all' is selected", async () => {
      const buildError = "error 1\nerror 2";
      
      // Mock readline module at the top level
      const mockReadline = {
        createInterface: vi.fn().mockReturnValue({
          question: vi.fn().mockImplementation((question, callback) => {
            // Immediately call callback with 'all'
            callback("all");
          }),
          close: vi.fn(),
        }),
      };
      
      // Mock require to return our mock readline
      vi.stubGlobal('require', vi.fn((moduleName) => {
        if (moduleName === 'readline') {
          return mockReadline;
        }
        return {};
      }));

      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes("npm run build")) {
          const error = new Error("Build failed") as any;
          error.stdout = Buffer.from(buildError);
          throw error;
        }
        return Buffer.from("");
      });

      const mockQuery = vi.mocked(claudeSDK.query);
      mockQuery.mockImplementation(async function* () {
        yield {
          type: "result",
          result: "Fixed all issues",
          is_error: false,
        } as any;
      });

      vi.mocked(writeFileSync).mockImplementation(() => {});

      await issueFixer({ interactive: true });

      expect(mockQuery).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});