import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import { query } from "@anthropic-ai/claude-code";

interface IssueFixerOptions {
  targetOnly?: boolean;
  interactive?: boolean;
  category?: string;
}

interface TransformationIssue {
  type: "build" | "test" | "lint" | "runtime" | "type";
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export async function issueFixer(options: IssueFixerOptions = {}) {
  console.log(chalk.blue("🔧 Running issue fixer..."));

  // Check for repomirror.yaml
  const configPath = join(process.cwd(), "repomirror.yaml");
  if (!existsSync(configPath)) {
    console.error(chalk.red("❌ repomirror.yaml not found. Please run 'npx repomirror init' first."));
    process.exit(1);
  }

  // Read configuration
  const yamlContent = readFileSync(configPath, "utf-8");
  const targetRepoMatch = yamlContent.match(/targetRepo:\s*["']?(.+?)["']?\s*$/m);
  const sourceRepoMatch = yamlContent.match(/sourceRepo:\s*["']?(.+?)["']?\s*$/m);
  const instructionsMatch = yamlContent.match(/transformationInstructions:\s*["']?(.+?)["']?\s*$/m);

  if (!targetRepoMatch || !sourceRepoMatch) {
    console.error(chalk.red("❌ Invalid repomirror.yaml configuration"));
    process.exit(1);
  }

  const targetRepo = targetRepoMatch[1];
  const sourceRepo = sourceRepoMatch[1];
  const instructions = instructionsMatch ? instructionsMatch[1] : "";

  console.log(chalk.gray(`Source: ${sourceRepo}`));
  console.log(chalk.gray(`Target: ${targetRepo}`));

  // Detect issues in the target repository
  const issues = await detectIssues(targetRepo, options.category);

  if (issues.length === 0) {
    console.log(chalk.green("✅ No issues detected!"));
    return;
  }

  console.log(chalk.yellow(`\n⚠️  Found ${issues.length} issue(s):\n`));
  
  issues.forEach((issue, index) => {
    console.log(chalk.yellow(`${index + 1}. [${issue.type}] ${issue.message}`));
    if (issue.file) {
      console.log(chalk.gray(`   File: ${issue.file}${issue.line ? `:${issue.line}` : ""}`));
    }
    if (issue.suggestion) {
      console.log(chalk.gray(`   Suggestion: ${issue.suggestion}`));
    }
  });

  if (options.interactive) {
    // Interactive mode - ask user which issues to fix
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question("\nWhich issues would you like to fix? (comma-separated numbers or 'all'): ", resolve);
    });
    rl.close();

    const issuesToFix = answer.toLowerCase() === "all" 
      ? issues 
      : issues.filter((_, index) => answer.split(",").map(n => parseInt(n.trim()) - 1).includes(index));

    await fixIssues(issuesToFix, targetRepo, sourceRepo, instructions);
  } else {
    // Auto-fix all issues
    console.log(chalk.blue("\n🔧 Attempting to auto-fix all issues..."));
    await fixIssues(issues, targetRepo, sourceRepo, instructions);
  }
}

async function detectIssues(targetRepo: string, category?: string): Promise<TransformationIssue[]> {
  const issues: TransformationIssue[] = [];
  
  // Change to target directory
  const originalDir = process.cwd();
  
  try {
    process.chdir(targetRepo);

    // Check for package.json to determine project type
    const isNodeProject = existsSync("package.json");
    const isPythonProject = existsSync("requirements.txt") || existsSync("pyproject.toml");
    const isGoProject = existsSync("go.mod");

    // Category filter
    const checkBuild = !category || category === "build";
    const checkTest = !category || category === "test";
    const checkLint = !category || category === "lint";
    const checkType = !category || category === "type";

    if (isNodeProject) {
      // Node/TypeScript project checks
      const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));

      // Build check
      if (checkBuild && packageJson.scripts?.build) {
        try {
          console.log(chalk.gray("Checking build..."));
          execSync("npm run build", { stdio: "pipe" });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const errorLines = output.split("\n").filter((line: string) => line.includes("error"));
          
          errorLines.forEach((line: string) => {
            const fileMatch = line.match(/([^:]+\.(ts|tsx|js|jsx)):(\d+):(\d+)/);
            issues.push({
              type: "build",
              message: line.trim(),
              file: fileMatch ? fileMatch[1] : undefined,
              line: fileMatch ? parseInt(fileMatch[2]) : undefined,
            });
          });
        }
      }

      // Type check
      if (checkType && packageJson.scripts?.typecheck) {
        try {
          console.log(chalk.gray("Checking types..."));
          execSync("npm run typecheck", { stdio: "pipe" });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const errorLines = output.split("\n").filter((line: string) => line.includes("error"));
          
          errorLines.forEach((line: string) => {
            const fileMatch = line.match(/([^:]+\.(ts|tsx)):(\d+):(\d+)/);
            issues.push({
              type: "type",
              message: line.trim(),
              file: fileMatch ? fileMatch[1] : undefined,
              line: fileMatch ? parseInt(fileMatch[2]) : undefined,
            });
          });
        }
      }

      // Lint check
      if (checkLint && packageJson.scripts?.lint) {
        try {
          console.log(chalk.gray("Checking linting..."));
          execSync("npm run lint", { stdio: "pipe" });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const errorLines = output.split("\n").filter((line: string) => line.includes("error"));
          
          errorLines.forEach((line: string) => {
            issues.push({
              type: "lint",
              message: line.trim(),
              suggestion: "Run 'npm run lint --fix' to auto-fix some issues",
            });
          });
        }
      }

      // Test check
      if (checkTest && packageJson.scripts?.test) {
        try {
          console.log(chalk.gray("Running tests..."));
          execSync("npm test", { stdio: "pipe", env: { ...process.env, CI: "true" } });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const failedTests = output.match(/✕.*$/gm) || [];
          
          failedTests.forEach((test: string) => {
            issues.push({
              type: "test",
              message: test.trim(),
            });
          });
        }
      }
    } else if (isPythonProject) {
      // Python project checks
      if (checkLint) {
        try {
          console.log(chalk.gray("Checking Python linting..."));
          execSync("ruff check .", { stdio: "pipe" });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const errorLines = output.split("\n").filter((line: string) => line.length > 0);
          
          errorLines.forEach((line: string) => {
            const fileMatch = line.match(/([^:]+\.py):(\d+):(\d+):\s*(.+)/);
            if (fileMatch) {
              issues.push({
                type: "lint",
                message: fileMatch[4],
                file: fileMatch[1],
                line: parseInt(fileMatch[2]),
              });
            }
          });
        }
      }

      if (checkType) {
        try {
          console.log(chalk.gray("Checking Python types..."));
          execSync("mypy .", { stdio: "pipe" });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const errorLines = output.split("\n").filter((line: string) => line.includes("error"));
          
          errorLines.forEach((line: string) => {
            const fileMatch = line.match(/([^:]+\.py):(\d+):\s*error:\s*(.+)/);
            if (fileMatch) {
              issues.push({
                type: "type",
                message: fileMatch[3],
                file: fileMatch[1],
                line: parseInt(fileMatch[2]),
              });
            }
          });
        }
      }
    } else if (isGoProject) {
      // Go project checks
      if (checkBuild) {
        try {
          console.log(chalk.gray("Checking Go build..."));
          execSync("go build ./...", { stdio: "pipe" });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const errorLines = output.split("\n").filter((line: string) => line.length > 0 && (line.includes("error") || line.includes("undefined") || line.includes("cannot use")));
          
          errorLines.forEach((line: string) => {
            issues.push({
              type: "build",
              message: line.trim(),
            });
          });
        }
      }

      if (checkTest) {
        try {
          console.log(chalk.gray("Running Go tests..."));
          execSync("go test ./...", { stdio: "pipe" });
        } catch (error: any) {
          const output = error.stdout?.toString() || error.stderr?.toString() || "";
          const failedTests = output.split("\n").filter((line: string) => line.includes("FAIL"));
          
          failedTests.forEach((test: string) => {
            issues.push({
              type: "test",
              message: test.trim(),
            });
          });
        }
      }
    }

    // Check for missing dependencies (common issue after transformation)
    if (isNodeProject && checkBuild) {
      try {
        execSync("npm ls", { stdio: "pipe" });
      } catch (error: any) {
        const output = error.stdout?.toString() || error.stderr?.toString() || "";
        if (output.includes("missing:")) {
          issues.push({
            type: "build",
            message: "Missing npm dependencies detected",
            suggestion: "Run 'npm install' to install missing dependencies",
          });
        }
      }
    }

  } finally {
    process.chdir(originalDir);
  }

  return issues;
}

async function fixIssues(
  issues: TransformationIssue[],
  targetRepo: string,
  sourceRepo: string,
  instructions: string
) {
  if (issues.length === 0) return;

  console.log(chalk.blue("\n🤖 Using Claude to fix issues..."));

  // Group issues by type for better context
  const issuesByType = issues.reduce((acc, issue) => {
    if (!acc[issue.type]) acc[issue.type] = [];
    acc[issue.type].push(issue);
    return acc;
  }, {} as Record<string, TransformationIssue[]>);

  // Create a comprehensive prompt for Claude
  const prompt = `You are helping fix issues in a transformed repository.

Original transformation: ${instructions}
Source repository: ${sourceRepo}
Target repository: ${targetRepo}

The following issues were detected in the target repository:

${Object.entries(issuesByType).map(([type, typeIssues]) => `
${type.toUpperCase()} ISSUES (${typeIssues.length}):
${typeIssues.map(issue => `
- ${issue.message}
${issue.file ? `  File: ${issue.file}${issue.line ? `:${issue.line}` : ""}` : ""}
${issue.suggestion ? `  Suggestion: ${issue.suggestion}` : ""}
`).join("")}
`).join("\n")}

Please analyze these issues and fix them by:
1. Understanding the root cause of each issue
2. Making necessary code changes to resolve them
3. Ensuring the fixes align with the transformation goals
4. Adding any missing dependencies or configurations
5. Following the existing code style and patterns

Work through each issue systematically and make the necessary changes to fix them.
After each fix, verify that it resolves the issue without introducing new problems.

Start by examining the target repository structure and the specific files mentioned in the issues.`;

  try {
    // Store the prompt for debugging
    const promptPath = join(process.cwd(), ".repomirror", "issue-fixer-prompt.md");
    writeFileSync(promptPath, prompt);
    console.log(chalk.gray(`Prompt saved to: ${promptPath}`));

    // Call Claude SDK to fix the issues
    console.log(chalk.blue("Requesting fixes from Claude..."));
    
    let result = "";
    let hasError = false;
    
    // Change to target directory for Claude to have access
    const originalCwd = process.cwd();
    process.chdir(targetRepo);
    
    try {
      for await (const message of query({
        prompt,
      })) {
        if (message.type === "result") {
          if (message.is_error) {
            hasError = true;
            console.error(chalk.red(`❌ Error from Claude: ${(message as any).result || "Unknown error"}`));
            throw new Error((message as any).result || "Claude SDK error");
          }
          result = (message as any).result || "";
          break; // Exit loop after getting result
        }
        // Handle assistant messages with tool calls
        if (message.type === "assistant" && (message as any).message?.content?.[0]?.name) {
          process.stdout.write(".");
        }
      }
    } finally {
      process.chdir(originalCwd);
    }

    if (!hasError && result) {
      console.log(chalk.green("\n✅ Issues have been addressed!"));
      console.log(chalk.gray("\nClaude's response:"));
      console.log(result);
      
      // Save the response for reference
      const responsePath = join(process.cwd(), ".repomirror", "issue-fixer-response.md");
      writeFileSync(responsePath, result);
      console.log(chalk.gray(`\nResponse saved to: ${responsePath}`));
      
      // Re-run detection to see if issues are fixed
      console.log(chalk.blue("\n🔍 Verifying fixes..."));
      const remainingIssues = await detectIssues(targetRepo);
      
      if (remainingIssues.length === 0) {
        console.log(chalk.green("✅ All issues have been successfully fixed!"));
      } else {
        console.log(chalk.yellow(`⚠️  ${remainingIssues.length} issue(s) remain. You may need to run the fixer again.`));
      }
    }
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to fix issues: ${error.message}`));
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
    throw error;
  }
}