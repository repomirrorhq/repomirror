import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline";

// Mock process.stdout.write
const mockStdoutWrite = vi.fn();

vi.mock("node:readline", () => ({
  createInterface: vi.fn(),
}));

// Import the module after mocking
const { visualize } = await import("../../src/commands/visualize");

describe("visualize command", () => {
  let mockReadlineInterface: any;
  let originalProcessArgv: string[];
  let stdoutWriteSpy: any;

  beforeEach(() => {
    // Save original values
    originalProcessArgv = [...process.argv];

    // Mock readline interface
    mockReadlineInterface = {
      on: vi.fn(),
    };

    vi.mocked(createInterface).mockReturnValue(mockReadlineInterface);

    // Mock process.stdout.write
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(mockStdoutWrite);

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original values
    process.argv = originalProcessArgv;
    
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("should create readline interface correctly", () => {
      visualize();

      expect(createInterface).toHaveBeenCalledWith({
        input: process.stdin,
        crlfDelay: Infinity,
      });
    });

    it("should setup event listeners on readline interface", () => {
      visualize();

      expect(mockReadlineInterface.on).toHaveBeenCalledWith("line", expect.any(Function));
      expect(mockReadlineInterface.on).toHaveBeenCalledWith("close", expect.any(Function));
    });
  });

  describe("debug mode detection", () => {
    it("should enable debug mode when --debug is in process.argv", () => {
      process.argv = ["node", "script.js", "--debug"];
      
      visualize();

      // Get the line handler from the mock call
      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      // Test with a valid JSON line
      const testJson = { type: "system", message: "test" };
      lineHandler(JSON.stringify(testJson));

      // Should include timestamp when debug mode is enabled
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("[")
      );
    });

    it("should enable debug mode when options.debug is true", () => {
      visualize({ debug: true });

      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      const testJson = { type: "system", message: "test" };
      lineHandler(JSON.stringify(testJson));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("[")
      );
    });

    it("should not include timestamp in normal mode", () => {
      process.argv = ["node", "script.js"];
      
      visualize();

      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      const testJson = { type: "system", message: "test" };
      lineHandler(JSON.stringify(testJson));

      // Should not include timestamp bracket
      const calls = mockStdoutWrite.mock.calls;
      const hasTimestamp = calls.some(call => 
        typeof call[0] === 'string' && call[0].includes('[2') // ISO timestamp starts with year
      );
      expect(hasTimestamp).toBe(false);
    });
  });

  describe("parsing different message types", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should handle system messages", () => {
      const systemMessage = {
        type: "system",
        subtype: "init",
        message: "System initialization"
      };

      lineHandler(JSON.stringify(systemMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("System")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("init")
      );
    });

    it("should handle user messages with text content", () => {
      const userMessage = {
        type: "user",
        message: {
          content: [{
            text: "This is a user message with some content that should be truncated if too long"
          }]
        }
      };

      lineHandler(JSON.stringify(userMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("User")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("This is a user message")
      );
    });

    it("should handle assistant messages", () => {
      const assistantMessage = {
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "This is an assistant response\nwith multiple lines\nof content\nthat should be truncated"
          }]
        }
      };

      lineHandler(JSON.stringify(assistantMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Assistant")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("This is an assistant response")
      );
    });

    it("should handle result messages", () => {
      const resultMessage = {
        type: "result",
        result: "Final result content goes here"
      };

      lineHandler(JSON.stringify(resultMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("=== Final Result ===")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Final result content goes here")
      );
    });
  });

  describe("tool call handling", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should handle tool calls with Read tool", () => {
      const toolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_123",
            name: "Read",
            input: {
              file_path: "/path/to/file.ts"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Read")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("/path/to/file.ts")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Waiting for result...")
      );
    });

    it("should handle tool calls with Bash tool", () => {
      const toolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_456",
            name: "Bash",
            input: {
              command: "ls -la",
              cwd: "/home/user",
              timeout: 5000
            }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Bash")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("ls -la")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("cwd: /home/user")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("timeout: 5000ms")
      );
    });

    it("should handle tool calls with Edit tool", () => {
      const toolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_789",
            name: "Edit",
            input: {
              file_path: "/path/to/file.ts",
              old_string: "function oldImplementation() {",
              new_string: "function newImplementation() {",
              limit: 100,
              offset: 50
            }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Edit")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("/path/to/file.ts")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("replace:")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("limit: 100")
      );
    });

    it("should handle tool results", () => {
      const toolResult = {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_123",
            content: "File content line 1\nFile content line 2\nFile content line 3\nMore content...",
            is_error: false
          }]
        }
      };

      lineHandler(JSON.stringify(toolResult));

      // When a tool result comes in without a matching tool call, 
      // it gets stored in pendingResults and doesn't output anything immediately
      // This is correct behavior - it's waiting for the tool call
      expect(mockStdoutWrite).not.toHaveBeenCalled();
    });

    it("should handle error tool results without matching tool calls", () => {
      const errorResult = {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_456",
            content: "Error: File not found",
            is_error: true
          }]
        }
      };

      lineHandler(JSON.stringify(errorResult));

      // Same behavior - error results are also stored and don't output immediately
      expect(mockStdoutWrite).not.toHaveBeenCalled();
    });

    it("should display tool results when matched with tool calls", () => {
      // First send a tool call
      const toolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_123",
            name: "Read",
            input: {
              file_path: "/test/file.ts"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));
      mockStdoutWrite.mockClear(); // Clear the tool call output

      // Then send the result - this should display them together
      const toolResult = {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_123",
            content: "File content line 1\nFile content line 2\nFile content line 3\nMore content...",
            is_error: false
          }]
        }
      };

      lineHandler(JSON.stringify(toolResult));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Tool Result");
      expect(outputStrings).toContain("4 lines");
      expect(outputStrings).toContain("File content line 1");
    });
  });

  describe("todo list handling", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should format TodoWrite tool calls specially", () => {
      const todoMessage = {
        type: "assistant",
        message: {
          content: [{
            name: "TodoWrite",
            input: {
              todos: [
                {
                  status: "completed",
                  content: "Read the source file",
                  priority: "high"
                },
                {
                  status: "in_progress", 
                  content: "Parse the JSON data",
                  priority: "medium"
                },
                {
                  status: "pending",
                  content: "Write tests for edge cases",
                  priority: "low"
                }
              ]
            }
          }]
        }
      };

      lineHandler(JSON.stringify(todoMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("📋")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Todo List Update")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("✅")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("🔄")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("⏸️")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("← ACTIVE")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("33% done")
      );
    });

    it("should handle empty todo lists", () => {
      const emptyTodoMessage = {
        type: "assistant",
        message: {
          content: [{
            name: "TodoWrite",
            input: {
              todos: []
            }
          }]
        }
      };

      lineHandler(JSON.stringify(emptyTodoMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Todo List Update")
      );
    });
  });

  describe("tool call and result pairing", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should pair tool calls with their results when call comes first", () => {
      // Send tool call first
      const toolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_123",
            name: "Read",
            input: {
              file_path: "/test/file.ts"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));

      // Then send result
      const toolResult = {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_123",
            content: "File contents here",
            is_error: false
          }]
        }
      };

      // Clear previous calls
      mockStdoutWrite.mockClear();
      
      lineHandler(JSON.stringify(toolResult));

      // Should display them together now
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Read")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("✅")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Tool Result")
      );
    });

    it("should pair tool calls with their results when result comes first", () => {
      // Send result first 
      const toolResult = {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_456",
            content: "Result content",
            is_error: false
          }]
        }
      };

      lineHandler(JSON.stringify(toolResult));

      // Then send call
      const toolCall = {
        type: "assistant", 
        message: {
          content: [{
            id: "tool_456",
            name: "Grep",
            input: {
              pattern: "test.*pattern"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));

      // Should display them together
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Grep")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("✅")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Tool Result")
      );
    });
  });

  describe("color formatting", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should apply correct colors for different message types", () => {
      const messages = [
        { type: "system", expected: "\x1b[35m" }, // magenta
        { type: "user", expected: "\x1b[34m" }, // blue  
        { type: "assistant", expected: "\x1b[32m" }, // green
        { type: "tool_use", expected: "\x1b[36m" }, // cyan
        { type: "tool_result", expected: "\x1b[33m" }, // yellow
      ];

      messages.forEach(({ type, expected }) => {
        mockStdoutWrite.mockClear();
        
        lineHandler(JSON.stringify({ type, message: "test" }));

        const calls = mockStdoutWrite.mock.calls;
        const hasExpectedColor = calls.some(call => 
          typeof call[0] === 'string' && call[0].includes(expected)
        );
        expect(hasExpectedColor).toBe(true);
      });
    });

    it("should reset colors properly", () => {
      const message = { type: "system", message: "test" };
      lineHandler(JSON.stringify(message));

      const calls = mockStdoutWrite.mock.calls;
      const hasResetColor = calls.some(call => 
        typeof call[0] === 'string' && call[0].includes("\x1b[0m")
      );
      expect(hasResetColor).toBe(true);
    });

    it("should use error colors when tool results are displayed", () => {
      // First send a tool call
      const toolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_123",
            name: "Read",
            input: {
              file_path: "/test/file.ts"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));
      mockStdoutWrite.mockClear(); // Clear the tool call output

      // Then send an error result - this should display them together with error colors
      const errorResult = {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_123",
            content: "Error message",
            is_error: true
          }]
        }
      };

      lineHandler(JSON.stringify(errorResult));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("\x1b[31m"); // red color for ERROR
    });
  });

  describe("error handling", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should handle invalid JSON gracefully", () => {
      const invalidJson = "{ invalid json here";
      
      lineHandler(invalidJson);

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Parse Error")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("{ invalid json here")
      );
    });

    it("should handle empty lines gracefully", () => {
      lineHandler("");
      lineHandler("   ");
      lineHandler("\n");

      // Should not throw or produce error output for empty lines
      const errorCalls = mockStdoutWrite.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes("Parse Error")
      );
      expect(errorCalls).toHaveLength(0);
    });

    it("should handle malformed message structures", () => {
      const malformedMessages = [
        { type: "assistant" }, // missing message
        { type: "user", message: null }, // null message
        { type: "tool_result" }, // missing required fields
      ];

      malformedMessages.forEach(message => {
        expect(() => {
          lineHandler(JSON.stringify(message));
        }).not.toThrow();
      });
    });
  });

  describe("final message handling", () => {
    let lineHandler: Function;
    let closeHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
      closeHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "close"
      )[1];
    });

    it("should display final assistant message on close", () => {
      const finalMessage = {
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "This is the final assistant message that should be displayed fully."
          }]
        }
      };

      lineHandler(JSON.stringify(finalMessage));
      closeHandler();

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("=== Final Assistant Message ===")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("This is the final assistant message that should be displayed fully.")
      );
    });

    it("should not display final message if last was a tool call", () => {
      const toolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_123",
            name: "Read",
            input: { file_path: "/test" }
          }]
        }
      };

      lineHandler(JSON.stringify(toolCall));
      mockStdoutWrite.mockClear();
      
      closeHandler();

      const finalMessageCalls = mockStdoutWrite.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes("=== Final Assistant Message ===")
      );
      expect(finalMessageCalls).toHaveLength(0);
    });

    it("should not display final message if no text content", () => {
      const messageWithoutText = {
        type: "assistant",
        message: {
          content: [{
            type: "image",
            data: "base64data"
          }]
        }
      };

      lineHandler(JSON.stringify(messageWithoutText));
      mockStdoutWrite.mockClear();
      
      closeHandler();

      const finalMessageCalls = mockStdoutWrite.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes("=== Final Assistant Message ===")
      );
      expect(finalMessageCalls).toHaveLength(0);
    });
  });

  describe("message content truncation and formatting", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should truncate long user messages", () => {
      const longMessage = "a".repeat(100);
      const userMessage = {
        type: "user",
        message: {
          content: [{
            text: longMessage
          }]
        }
      };

      lineHandler(JSON.stringify(userMessage));

      const calls = mockStdoutWrite.mock.calls;
      const hasEllipsis = calls.some(call => 
        typeof call[0] === 'string' && call[0].includes("...")
      );
      expect(hasEllipsis).toBe(true);
    });

    it("should show limited lines from assistant messages", () => {
      const multilineMessage = {
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
          }]
        }
      };

      lineHandler(JSON.stringify(multilineMessage));

      const calls = mockStdoutWrite.mock.calls;
      const hasEllipsis = calls.some(call => 
        typeof call[0] === 'string' && call[0].includes("...")
      );
      expect(hasEllipsis).toBe(true);
    });

    it("should show usage statistics when available", () => {
      const messageWithUsage = {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 150,
            output_tokens: 75
          },
          content: [{ type: "text", text: "Response with usage stats" }]
        }
      };

      lineHandler(JSON.stringify(messageWithUsage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("150/75 tokens")
      );
    });
  });
});