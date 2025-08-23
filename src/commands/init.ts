import { promises as fs } from "fs";
import { join, basename } from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { query } from "@anthropic-ai/claude-code";
import { execa } from "execa";

interface InitOptions {
  sourceRepo: string;
  targetRepo: string;
  transformationInstructions: string;
}

export async function init(): Promise<void> {
  console.log(
    chalk.cyan("I'll help you maintain a transformed copy of this repo:\n"),
  );

  // Get current directory name for default target
  const currentDir = process.cwd();
  const repoName = basename(currentDir);
  const defaultTarget = `../${repoName}-transformed`;

  const answers = await inquirer.prompt<InitOptions>([
    {
      type: "input",
      name: "sourceRepo",
      message: "Source Repo you want to transform:",
      default: "./",
    },
    {
      type: "input",
      name: "targetRepo",
      message: "Where do you want to transform code to:",
      default: defaultTarget,
    },
    {
      type: "input",
      name: "transformationInstructions",
      message: "What changes do you want to make:",
      default: "translate this python repo to typescript",
    },
  ]);

  // Perform preflight checks
  await performPreflightChecks(answers.targetRepo);

  // Generate transformation prompt using Claude SDK
  const spinner = ora("Generating transformation prompt...").start();

  try {
    const optimizedPrompt = await generateTransformationPrompt(
      answers.sourceRepo,
      answers.targetRepo,
      answers.transformationInstructions,
    );

    spinner.succeed("Generated transformation prompt");

    // Create .repomirror directory and files
    await createRepoMirrorFiles(
      answers.sourceRepo,
      answers.targetRepo,
      optimizedPrompt,
    );

    console.log(chalk.green("\n✅ repomirror initialized successfully!"));
    console.log(chalk.cyan("\nNext steps:"));
    console.log(
      chalk.white(
        "• Run `npx repomirror sync` - this will run the sync.sh script once",
      ),
    );
    console.log(
      chalk.white(
        "• Run `npx repomirror sync-forever` - this will run the ralph.sh script, working forever to implement all the changes",
      ),
    );
  } catch (error) {
    spinner.fail("Failed to generate transformation prompt");
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(1);
  }
}

async function performPreflightChecks(targetRepo: string): Promise<void> {
  const spinner = ora("Performing preflight checks...").start();

  try {
    // Check if target directory exists
    try {
      await fs.access(targetRepo);
    } catch {
      spinner.fail(`Target directory ${targetRepo} does not exist`);
      process.exit(1);
    }

    // Check if target directory is a git repo
    try {
      await execa("git", ["rev-parse", "--git-dir"], { cwd: targetRepo });
    } catch {
      spinner.fail(`Target directory ${targetRepo} is not a git repository`);
      process.exit(1);
    }

    // Check if target directory has at least one upstream
    try {
      const { stdout } = await execa("git", ["remote", "-v"], {
        cwd: targetRepo,
      });
      if (!stdout.trim()) {
        spinner.fail(
          `Target directory ${targetRepo} has no git remotes configured`,
        );
        process.exit(1);
      }
    } catch {
      spinner.fail(`Failed to check git remotes in ${targetRepo}`);
      process.exit(1);
    }

    // Check if Claude Code is configured
    try {
      const { stdout } = await execa("claude", ["-p", "say hi"]);
      if (!stdout.toLowerCase().includes("hi")) {
        spinner.fail("Claude Code test failed - response doesn't contain 'hi'");
        process.exit(1);
      }
    } catch {
      spinner.fail(
        "Claude Code is not properly configured. Please run `claude` to set up your profile",
      );
      process.exit(1);
    }

    spinner.succeed("All preflight checks passed");
  } catch (error) {
    spinner.fail(
      `Preflight check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

async function generateTransformationPrompt(
  sourceRepo: string,
  targetRepo: string,
  transformationInstructions: string,
): Promise<string> {
  const metaPrompt = `your task is to generate an optimized prompt for repo transformation. The prompt should match the format of the examples below.

<example 1>
Your job is to port [SOURCE PATH] monorepo (for react) to [TARGET PATH] (for vue) and maintain the repository.

You have access to the current [SOURCE PATH] repositorty as well as the [TARGET PATH] repository.

Make a commit and push your changes after every single file edit.

Use the [TARGET_PATH]/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.
</example 1>

<example 2>
Your job is to port browser-use monorepo (Python) to browser-use-ts (Typescript) and maintain the repository.

You have access to the current [SOURCE PATH] repositorty as well as the target [TARGET_PATH] repository.

Make a commit and push your changes after every single file edit.

Use the [TARGET PATH]/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.
</example 2>

The users instructions for transformation are:

<user instructions>
${transformationInstructions}
</user instructions>

Your Job:

When you are ready, respond with EXACTLY the prompt matching the example, tailored for following the users' instructions and nothing else.

You should follow the format EXACTLY, filling in information based on what you learn from a CURSORY exploration of the source repo (this directory). Ensure you ONLY use the read tools (Read, Search, Grep, LS, Glob, etc) to explore the repo. You only need enough sense to build a good prompt, so dont use subagents.`;

  let result = "";
  for await (const message of query({
    prompt: metaPrompt,
  })) {
    if (message.type === "result" && !message.is_error) {
      result = (message as any).result || "";
      break;
    }
  }

  if (!result) {
    throw new Error("Failed to generate transformation prompt");
  }

  // Replace placeholders with actual paths
  return result
    .replace(/\[SOURCE PATH\]/g, sourceRepo)
    .replace(/\[TARGET PATH\]/g, targetRepo)
    .replace(/\[TARGET_PATH\]/g, targetRepo);
}

async function createRepoMirrorFiles(
  sourceRepo: string,
  targetRepo: string,
  optimizedPrompt: string,
): Promise<void> {
  const repoMirrorDir = join(process.cwd(), ".repomirror");

  // Create .repomirror directory
  await fs.mkdir(repoMirrorDir, { recursive: true });

  // Create prompt.md
  await fs.writeFile(join(repoMirrorDir, "prompt.md"), optimizedPrompt);

  // Create sync.sh
  const syncScript = `#!/bin/bash
cat .repomirror/prompt.md | \\
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir ${targetRepo} | \\
        tee -a .repomirror/claude_output.jsonl | \\
        npx repomirror visualize --debug;`;

  await fs.writeFile(join(repoMirrorDir, "sync.sh"), syncScript, {
    mode: 0o755,
  });

  // Create ralph.sh
  const ralphScript = `#!/bin/bash
while :; do
  ./.repomirror/sync.sh
  echo -e "===SLEEP===\\n===SLEEP===\\n"; echo 'looping';
  sleep 10;
done`;

  await fs.writeFile(join(repoMirrorDir, "ralph.sh"), ralphScript, {
    mode: 0o755,
  });

  // Create .gitignore
  await fs.writeFile(
    join(repoMirrorDir, ".gitignore"),
    "claude_output.jsonl\n",
  );
}
