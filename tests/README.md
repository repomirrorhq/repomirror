# Test Suite for repomirror

This directory contains the test suite for the repomirror project using Vitest.

## Structure

```
tests/
├── README.md           # This file
├── setup.ts            # Global test setup
├── basic.test.ts       # Basic functionality tests
├── commands/           # Command-specific tests
│   └── simple.test.ts  # Example command tests
└── helpers/            # Test utilities and helpers
    ├── index.ts        # Helper exports
    ├── test-utils.ts   # Test utility functions
    └── fixtures.ts     # Mock data and fixtures
```

## Configuration

The test configuration is defined in `vitest.config.ts` in the project root:

- **Environment**: Node.js
- **Coverage**: V8 provider with HTML and JSON reports
- **TypeScript**: Full TypeScript support with path aliases
- **Coverage Thresholds**: 80% for branches, functions, lines, and statements

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npx vitest run tests/basic.test.ts

# Run tests in watch mode
npx vitest
```

## Test Utilities

The `helpers/` directory provides utilities for testing:

### `test-utils.ts`
- `createTempDir()` - Create temporary directories for testing
- `cleanupTempDir()` - Clean up temporary directories
- `createMockGitRepo()` - Create mock git repositories
- `mockConsole()` - Mock console methods
- `mockProcess()` - Mock process methods
- `mockInquirer()` - Mock inquirer prompts
- `mockOra()` - Mock ora spinners
- `mockExeca()` - Mock command execution

### `fixtures.ts`
- Pre-defined mock data for consistent testing
- Sample repository configurations
- Mock command responses
- File structure templates

## Writing Tests

Example test structure:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTempDir, cleanupTempDir, mockConsole } from "../helpers";

describe("your feature", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Setup test environment
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.restoreAllMocks();
  });

  it("should do something", async () => {
    // Your test code here
    expect(true).toBe(true);
  });
});
```

## Coverage

Coverage reports are generated in the `coverage/` directory:
- HTML report: `coverage/index.html`
- JSON report: `coverage/coverage.json`

The project maintains coverage thresholds of 80% across all metrics.

## TypeScript Support

Tests have full TypeScript support with:
- Path aliases: `@/` for `src/`, `@tests/` for `tests/`
- Type checking during test runs
- Import resolution for both source and test files

## Integration with CI/CD

The test suite is designed to work with continuous integration:
- Exit codes properly indicate success/failure
- Coverage reports can be uploaded to coverage services
- Tests run in isolated environments