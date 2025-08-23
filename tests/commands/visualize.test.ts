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

    it("should handle JSON with syntax errors", () => {
      const malformedJsons = [
        '{"type": "system", "message": "incomplete',
        '{"type": "user" "message": "missing colon"}',
        '{"type": "assistant", "message": {"content": [{"text": "unclosed quote}]}}',
        '{"type": []}', // invalid type
        'null',
        'undefined',
        '{"type": "system", "message": "test", }', // trailing comma
      ];

      malformedJsons.forEach(json => {
        mockStdoutWrite.mockClear();
        lineHandler(json);
        
        expect(mockStdoutWrite).toHaveBeenCalledWith(
          expect.stringContaining("Parse Error")
        );
      });
    });

    it("should handle extremely long lines gracefully", () => {
      const longMessage = "a".repeat(10000);
      const longJson = JSON.stringify({ type: "system", message: longMessage });
      
      expect(() => {
        lineHandler(longJson);
      }).not.toThrow();
      
      // Should process the message successfully even if it's large
      expect(mockStdoutWrite).toHaveBeenCalled();
    });

    it("should handle non-string JSON values in content", () => {
      const messageWithNumbers = {
        type: "user",
        message: {
          content: [{
            text: 12345 // number instead of string
          }]
        }
      };

      expect(() => {
        lineHandler(JSON.stringify(messageWithNumbers));
      }).not.toThrow();
    });

    it("should handle circular reference errors gracefully", () => {
      // Create a message that would cause issues when stringifying internally
      const messageWithUndefined = {
        type: "system",
        message: undefined,
        subtype: "test"
      };

      expect(() => {
        lineHandler(JSON.stringify(messageWithUndefined));
      }).not.toThrow();
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

    it("should handle messages with only zero token usage", () => {
      const messageWithZeroUsage = {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 0,
            output_tokens: 0
          },
          content: [{ type: "text", text: "Response with zero usage" }]
        }
      };

      lineHandler(JSON.stringify(messageWithZeroUsage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("0/0 tokens")
      );
    });

    it("should handle partial usage statistics", () => {
      const messageWithPartialUsage = {
        type: "assistant",
        message: {
          usage: {
            input_tokens: 100
            // missing output_tokens
          },
          content: [{ type: "text", text: "Response with partial usage" }]
        }
      };

      lineHandler(JSON.stringify(messageWithPartialUsage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("100/0 tokens")
      );
    });

    it("should handle messages with Unicode characters", () => {
      const unicodeMessage = {
        type: "user",
        message: {
          content: [{
            text: "Hello 🌍 World! 中文字符 Émojis 🎉 and more: ñáéíóú"
          }]
        }
      };

      lineHandler(JSON.stringify(unicodeMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Hello 🌍 World!")
      );
    });

    it("should handle newlines and special characters in content", () => {
      const specialCharMessage = {
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "Line with \\t tab\\nLine with \\r return\\nLine with \\\\backslash"
          }]
        }
      };

      lineHandler(JSON.stringify(specialCharMessage));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Line with");
    });

    it("should format different content item types correctly", () => {
      const mixedContentMessage = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Text content" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
            { type: "tool_use", id: "tool_1", name: "Read", input: { file_path: "/test" } }
          ]
        }
      };

      lineHandler(JSON.stringify(mixedContentMessage));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("3 content items")
      );
    });
  });

  describe("comprehensive JSONL parsing from stdin", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should process multiple JSONL lines sequentially", () => {
      const jsonlLines = [
        JSON.stringify({ type: "system", subtype: "init", message: "Starting session" }),
        JSON.stringify({ type: "user", message: { content: [{ text: "User request" }] } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Assistant response" }] } }),
        JSON.stringify({ type: "result", result: "Final output" })
      ];

      jsonlLines.forEach(line => {
        lineHandler(line);
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("System")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("User")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Assistant")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("=== Final Result ===")
      );
    });

    it("should handle interleaved tool calls and results in JSONL stream", () => {
      const jsonlSequence = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{
              id: "tool_1",
              name: "Read",
              input: { file_path: "/test1.ts" }
            }]
          }
        }),
        JSON.stringify({
          type: "assistant", 
          message: {
            content: [{
              id: "tool_2",
              name: "Grep",
              input: { pattern: "test" }
            }]
          }
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [{
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "File contents 1",
              is_error: false
            }]
          }
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [{
              type: "tool_result",
              tool_use_id: "tool_2",
              content: "Search results",
              is_error: false
            }]
          }
        })
      ];

      jsonlSequence.forEach(line => {
        lineHandler(line);
      });

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Read");
      expect(outputStrings).toContain("Grep");
      expect(outputStrings).toContain("Tool Result");
    });

    it("should handle streaming assistant responses", () => {
      const streamingMessages = [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Let me help" }] } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Let me help you" }] } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Let me help you with that" }] } })
      ];

      streamingMessages.forEach(line => {
        lineHandler(line);
      });

      const assistantCalls = mockStdoutWrite.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('Assistant')
      );
      expect(assistantCalls).toHaveLength(3);
    });
  });

  describe("different message types comprehensive coverage", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should handle info message type", () => {
      const infoMessage = {
        type: "info",
        message: "Information message",
        level: "info"
      };

      lineHandler(JSON.stringify(infoMessage));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Info");
    });

    it("should handle warning message type", () => {
      const warningMessage = {
        type: "warning",
        message: "Warning message",
        level: "warning"
      };

      lineHandler(JSON.stringify(warningMessage));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Warning");
    });

    it("should handle error message type", () => {
      const errorMessage = {
        type: "error",
        message: "Error message",
        error: {
          code: "E001",
          description: "Something went wrong"
        }
      };

      lineHandler(JSON.stringify(errorMessage));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Error");
    });

    it("should handle tool_use message type directly", () => {
      const toolUseMessage = {
        type: "tool_use",
        name: "DirectTool",
        input: { parameter: "value" }
      };

      lineHandler(JSON.stringify(toolUseMessage));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Tool_use");
    });

    it("should handle debug message type", () => {
      const debugMessage = {
        type: "debug",
        message: "Debug information",
        details: { step: 1, context: "parsing" }
      };

      lineHandler(JSON.stringify(debugMessage));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Debug");
    });

    it("should handle progress message type", () => {
      const progressMessage = {
        type: "progress",
        message: "Processing files",
        progress: {
          current: 5,
          total: 10,
          percentage: 50
        }
      };

      lineHandler(JSON.stringify(progressMessage));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Progress");
    });

    it("should handle unknown message types gracefully", () => {
      const unknownMessage = {
        type: "custom_type",
        message: "Custom message format",
        data: { custom: "data" }
      };

      expect(() => {
        lineHandler(JSON.stringify(unknownMessage));
      }).not.toThrow();

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Custom_type");
    });
  });

  describe("stream processing and buffering", () => {
    it("should handle rapid successive JSONL lines", () => {
      visualize();
      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      // Simulate rapid input
      const rapidMessages = Array.from({ length: 100 }, (_, i) => 
        JSON.stringify({ type: "system", message: `Message ${i}` })
      );

      rapidMessages.forEach(line => {
        lineHandler(line);
      });

      // Should handle all messages without errors
      expect(mockStdoutWrite.mock.calls.length).toBeGreaterThan(0);
    });

    it("should handle large JSON objects in stream", () => {
      visualize();
      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      // Create a large message
      const largeContent = "Large content ".repeat(1000);
      const largeMessage = {
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: largeContent
          }],
          usage: {
            input_tokens: 5000,
            output_tokens: 3000
          }
        }
      };

      expect(() => {
        lineHandler(JSON.stringify(largeMessage));
      }).not.toThrow();

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("5000/3000 tokens")
      );
    });

    it("should maintain state across multiple tool call/result pairs", () => {
      visualize();
      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      // Send multiple interleaved tool calls and results
      const toolCall1 = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ id: "tool_1", name: "Read", input: { file_path: "/file1" } }]
        }
      });

      const toolCall2 = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ id: "tool_2", name: "Edit", input: { file_path: "/file2" } }]
        }
      });

      const result1 = JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_1",
            content: "File 1 content",
            is_error: false
          }]
        }
      });

      const result2 = JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool_2", 
            content: "File 2 edited",
            is_error: false
          }]
        }
      });

      // Send in mixed order: call1, call2, result1, result2
      lineHandler(toolCall1);
      lineHandler(toolCall2);
      mockStdoutWrite.mockClear();
      lineHandler(result1);
      
      // Should display tool1 + result1 together
      let outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Read");
      expect(outputStrings).toContain("File 1 content");

      mockStdoutWrite.mockClear();
      lineHandler(result2);
      
      // Should display tool2 + result2 together
      outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("Edit");
      expect(outputStrings).toContain("File 2 edited");
    });
  });

  describe("comprehensive tool call variations", () => {
    let lineHandler: Function;

    beforeEach(() => {
      visualize();
      lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];
    });

    it("should handle Write tool calls", () => {
      const writeToolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_write",
            name: "Write",
            input: {
              file_path: "/new/file.ts",
              content: "New file content"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(writeToolCall));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Write")
      );
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("/new/file.ts")
      );
    });

    it("should handle Glob tool calls", () => {
      const globToolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_glob",
            name: "Glob",
            input: {
              pattern: "**/*.ts",
              path: "/src"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(globToolCall));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Glob")
      );
      // The implementation shows path first as the main argument, then pattern in details
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("/src")
      );
    });

    it("should handle WebFetch tool calls", () => {
      const webFetchCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_web",
            name: "WebFetch",
            input: {
              url: "https://example.com",
              prompt: "Extract the main content from this page"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(webFetchCall));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("WebFetch")
      );
      // The implementation shows prompt first as the main argument, not URL
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("Extract the main content")
      );
    });

    it("should handle tool calls with multiple complex parameters", () => {
      const complexToolCall = {
        type: "assistant",
        message: {
          content: [{
            id: "tool_complex",
            name: "ComplexTool",
            input: {
              query: "search term",
              limit: 50,
              offset: 10,
              include: "*.json",
              timeout: 30000,
              old_string: "function oldName() { return 'old'; }",
              new_string: "function newName() { return 'new'; }"
            }
          }]
        }
      };

      lineHandler(JSON.stringify(complexToolCall));

      const outputStrings = mockStdoutWrite.mock.calls.map(call => call[0]).join('');
      expect(outputStrings).toContain("ComplexTool");
      expect(outputStrings).toContain("search term");
      expect(outputStrings).toContain("limit: 50");
      expect(outputStrings).toContain("offset: 10");
      expect(outputStrings).toContain("timeout: 30000ms");
      expect(outputStrings).toContain("replace:");
    });
  });

  describe("debug mode comprehensive behavior", () => {
    it("should display timestamps in ISO format in debug mode", () => {
      const mockDate = new Date('2023-12-01T10:30:45.123Z');
      vi.spyOn(global, 'Date').mockImplementation(() => mockDate);
      
      visualize({ debug: true });
      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      lineHandler(JSON.stringify({ type: "system", message: "test" }));

      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining("[2023-12-01T10:30:45.123Z]")
      );

      vi.restoreAllMocks();
    });

    it("should handle debug mode with complex message sequences", () => {
      visualize({ debug: true });
      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      const complexSequence = [
        JSON.stringify({ type: "system", subtype: "start", message: "Starting" }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ id: "tool_1", name: "Read", input: { file_path: "/test" } }]
          }
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [{
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "file content",
              is_error: false
            }]
          }
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Final response" }]
          }
        })
      ];

      complexSequence.forEach(line => {
        lineHandler(line);
      });

      // All messages should have timestamps
      const timestampCalls = mockStdoutWrite.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('[')
      );
      expect(timestampCalls.length).toBeGreaterThan(0);
    });

    it("should work correctly when both debug option and argv flag are present", () => {
      process.argv = ["node", "script.js", "--debug"];
      
      visualize({ debug: true }); // Both option and argv
      const lineHandler = mockReadlineInterface.on.mock.calls.find(
        (call) => call[0] === "line"
      )[1];

      lineHandler(JSON.stringify({ type: "system", message: "test" }));

      // Should still show timestamps (not double)
      const calls = mockStdoutWrite.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('[') && call[0].includes(']')
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});