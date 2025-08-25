import { promises as fs } from "fs";
import path, { join, basename, resolve } from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { query } from "@anthropic-ai/claude-code";
import { execa } from "execa";
import yaml from "yaml";

interface InitOptions {
  sourceRepo: string;
  targetRepo: string;
  transformationInstructions: string;
}

interface RemoteConfig {
  url: string;
  branch: string;
  auto_push?: boolean;
}

interface RepoMirrorConfig {
  sourceRepo: string;
  targetRepo: string;
  transformationInstructions: string;
  remotes?: {
    [remoteName: string]: RemoteConfig;
  };
  push?: {
    default_remote?: string;
    default_branch?: string;
    commit_prefix?: string;
  };
  pull?: {
    auto_sync?: boolean;
    source_remote?: string;
    source_branch?: string;
  };
}

async function loadExistingConfig(sourceRepo?: string): Promise<Partial<RepoMirrorConfig> | null> {
  try {
    // Use process.cwd() as base for relative paths to ensure proper mocking in tests
    const baseDir = sourceRepo && sourceRepo !== "./" 
      ? resolve(process.cwd(), sourceRepo) 
      : process.cwd();
    const configPath = join(baseDir, "repomirror.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    return yaml.parse(configContent) as RepoMirrorConfig;
  } catch {
    return null;
  }
}

async function saveConfig(config: RepoMirrorConfig, sourceRepo?: string): Promise<void> {
  // Use process.cwd() as base for relative paths to ensure proper mocking in tests
  const baseDir = sourceRepo && sourceRepo !== "./" 
    ? resolve(process.cwd(), sourceRepo) 
    : process.cwd();
  // Ensure the directory exists before writing the config
  await fs.mkdir(baseDir, { recursive: true });
  const configPath = join(baseDir, "repomirror.yaml");
  const configContent = yaml.stringify(config);
  await fs.writeFile(configPath, configContent, "utf-8");
}

export async function init(cliOptions?: Partial<InitOptions>): Promise<void> {
  console.log(
    chalk.cyan("I'll help you maintain a transformed copy of this repo:\n"),
  );

  // Load existing config if present from source repo
  const sourceRepoPath = cliOptions?.sourceRepo || "./";
  const existingConfig = await loadExistingConfig(sourceRepoPath);
  if (existingConfig) {
    console.log(
      chalk.yellow("Found existing repomirror.yaml, using as defaults\n"),
    );
  }

  // Get current directory name for default target
  const currentDir = process.cwd();
  const repoName = basename(currentDir);
  const defaultTarget =
    existingConfig?.targetRepo || `../${repoName}-transformed`;

  // Merge CLI options, existing config, and defaults
  const defaults = {
    sourceRepo: cliOptions?.sourceRepo || existingConfig?.sourceRepo || "./",
    targetRepo:
      cliOptions?.targetRepo || existingConfig?.targetRepo || defaultTarget,
    transformationInstructions:
      cliOptions?.transformationInstructions ||
      existingConfig?.transformationInstructions ||
      "translate this python repo to typescript",
  };

  const answers = await inquirer.prompt<InitOptions>([
    {
      type: "input",
      name: "sourceRepo",
      message: "Source Repo you want to transform:",
      default: defaults.sourceRepo,
      when: !cliOptions?.sourceRepo,
    },
    {
      type: "input",
      name: "targetRepo",
      message: "Where do you want to transform code to:",
      default: defaults.targetRepo,
      when: !cliOptions?.targetRepo,
    },
    {
      type: "input",
      name: "transformationInstructions",
      message: "What changes do you want to make:",
      default: defaults.transformationInstructions,
      when: !cliOptions?.transformationInstructions,
    },
  ]);

  // Merge CLI options with answers
  const finalConfig: InitOptions = {
    sourceRepo: cliOptions?.sourceRepo || answers.sourceRepo,
    targetRepo: cliOptions?.targetRepo || answers.targetRepo,
    transformationInstructions:
      cliOptions?.transformationInstructions ||
      answers.transformationInstructions,
  };

  // Save configuration to repomirror.yaml in source directory
  await saveConfig(finalConfig, finalConfig.sourceRepo);
  console.log(chalk.green("\n✅ Saved configuration to repomirror.yaml"));

  // Perform preflight checks
  await performPreflightChecks(finalConfig.targetRepo);

  // Generate transformation prompt using Claude SDK
  console.log(chalk.cyan("\nGenerating transformation prompt..."));

  try {
    const optimizedPrompt = await generateTransformationPrompt(
      finalConfig.sourceRepo,
      finalConfig.targetRepo,
      finalConfig.transformationInstructions,
    );

    console.log(chalk.green("✔ Generated transformation prompt"));

    // Create .repomirror directory and files
    await createRepoMirrorFiles(
      finalConfig.sourceRepo,
      finalConfig.targetRepo,
      optimizedPrompt,
    );

    console.log(chalk.green("\n✅ repomirror initialized successfully!"));
    console.log(chalk.cyan("\nNext steps:"));
    console.log(
      chalk.white(
        "run `npx repomirror sync` - this will run the sync.sh script once",
      ),
    );
    console.log("");
    console.log(
      chalk.white(
        "run `npx repomirror sync-forever` - this will run the ralph.sh script, working forever to implement all the changes",
      ),
    );
    console.log("");
    console.log(
      chalk.white(
        "The following files were created and safe to commit. Edit prompt.md as you see fit, but you probably dont want to run these files directly",
      ),
    );
    console.log("");
    console.log(chalk.white("- .repomirror/prompt.md # prompt"));
    console.log(chalk.white("- .repomirror/sync.sh"));
    console.log(chalk.white("- .repomirror/ralph.sh"));
    console.log(chalk.white("- .repomirror/.gitignore"));
  } catch (error) {
    console.log(chalk.red("✖ Failed to generate transformation prompt"));
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(1);
  }
}

async function performPreflightChecks(targetRepo: string): Promise<void> {
  console.log(chalk.cyan("\n🔍 Performing preflight checks...\n"));

  // Check if target directory exists
  console.log(chalk.white("1. Checking if target directory exists..."));
  const dirSpinner = ora(`   Accessing ${targetRepo}`).start();
  try {
    await fs.access(targetRepo);
    dirSpinner.succeed(`   Target directory ${chalk.green(targetRepo)} exists`);
  } catch {
    dirSpinner.fail(
      `   Target directory ${chalk.red(targetRepo)} does not exist`,
    );
    process.exit(1);
  }

  // Check if target directory is a git repo
  console.log(
    chalk.white("2. Checking if target directory is a git repository..."),
  );
  const gitSpinner = ora(
    `   Verifying git repository in ${targetRepo}`,
  ).start();
  try {
    const { stdout } = await execa("git", ["rev-parse", "--git-dir"], {
      cwd: targetRepo,
    });
    const gitDir = stdout.trim();
    gitSpinner.succeed(
      `   Git repository found (git dir: ${chalk.green(gitDir)})`,
    );
  } catch {
    gitSpinner.fail(
      `   Target directory ${chalk.red(targetRepo)} is not a git repository`,
    );
    process.exit(1);
  }

  // Check if target directory has at least one upstream
  console.log(chalk.white("3. Checking git remotes configuration..."));
  const remoteSpinner = ora(`   Listing git remotes in ${targetRepo}`).start();
  try {
    const { stdout } = await execa("git", ["remote", "-v"], {
      cwd: targetRepo,
    });
    if (!stdout.trim()) {
      remoteSpinner.fail(
        `   Target directory ${chalk.red(targetRepo)} has no git remotes configured`,
      );
      process.exit(1);
    }

    const remotes = stdout.trim().split("\n");
    const remoteNames = [
      ...new Set(remotes.map((line) => line.split("\t")[0])),
    ];
    remoteSpinner.succeed(
      `   Found ${chalk.green(remoteNames.length)} git remote(s): ${chalk.green(remoteNames.join(", "))}`,
    );

    // Show the actual remotes for user reference
    console.log(chalk.gray("   Remotes:"));
    remotes.forEach((remote) => {
      console.log(chalk.gray(`     ${remote}`));
    });
  } catch {
    remoteSpinner.fail(
      `   Failed to check git remotes in ${chalk.red(targetRepo)}`,
    );
    process.exit(1);
  }

  // Check if Claude Code is configured (skip in test mode)
  if (process.env.SKIP_CLAUDE_TEST === "true") {
    console.log(chalk.yellow("4. Skipping Claude Code test (test mode)"));
  } else {
    console.log(chalk.white("4. Testing Claude Code configuration..."));
    const claudeSpinner = ora("   Running Claude Code test command").start();
    try {
      const { stdout } = await execa("claude", ["-p", "say hi with more than one word"], {
        timeout: 30000, // 30 second timeout
        input: "", // Provide empty stdin to prevent claude from waiting
      });
      // Check if Claude responded with something reasonable (not empty and more than 10 chars)
      if (!stdout || stdout.trim().length < 10) {
        claudeSpinner.fail(
          "   Claude Code test failed - response was empty or too short",
        );
        console.log(
          chalk.gray(
            `   Actual response: ${stdout.slice(0, 100)}${stdout.length > 100 ? "..." : ""}`,
          ),
        );
        process.exit(1);
      }
      claudeSpinner.succeed("   Claude Code is working correctly");
      console.log(
        chalk.gray(
          `   Claude response: ${stdout.slice(0, 100)}${stdout.length > 100 ? "..." : ""}`,
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("timed out")) {
        claudeSpinner.fail("   Claude Code test timed out after 30 seconds");
        console.log(chalk.red("   The 'claude -p \"say hi\"' command is not responding"));
        console.log(chalk.yellow("   This might indicate an issue with your Claude Code setup"));
      } else {
        claudeSpinner.fail("   Claude Code is not properly configured");
        console.log(chalk.red("   Please run `claude` to set up your profile"));
      }
      if (error instanceof Error) {
        console.log(chalk.gray(`   Error: ${error.message}`));
      }
      process.exit(1);
    }
  }

  console.log(chalk.green("\n✅ All preflight checks passed!\n"));
}

async function generateTransformationPrompt(
  sourceRepo: string,
  targetRepo: string,
  transformationInstructions: string,
): Promise<string> {
  // In test mode, return a simple template without calling Claude
  if (process.env.SKIP_CLAUDE_TEST === "true") {
    const testPrompt = `Your job is to port ${sourceRepo} to ${targetRepo} and maintain the repository.

You have access to the current ${sourceRepo} repository as well as the ${targetRepo} repository.

Make a commit and push your changes after every single file edit.

Use the ${targetRepo}/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

${transformationInstructions}`;
    return testPrompt;
  }

  const metaPrompt = `your task is to generate an optimized prompt for repo transformation. The prompt should match the format of the examples below.

<example 1>
Your job is to port [SOURCE PATH] monorepo (for react) to [TARGET PATH] (for vue) and maintain the repository.

You have access to the current [SOURCE PATH] repository as well as the [TARGET PATH] repository.

Make a commit and push your changes after every single file edit.

Use the [TARGET_PATH]/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.
</example 1>

<example 2>
Your job is to port browser-use monorepo (Python) to browser-use-ts (Typescript) and maintain the repository.

You have access to the current [SOURCE PATH] repository as well as the target [TARGET_PATH] repository.

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
  let toolCallCount = 0;
  let queryAborted = false;
  
  // Handle graceful shutdown during Claude SDK query
  const signalHandler = () => {
    console.log(chalk.yellow("\n\nStopping prompt generation..."));
    queryAborted = true;
    process.exit(0);
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
  
  try {
    for await (const message of query({
      prompt: metaPrompt,
    })) {
      if (queryAborted) break;
    // Stream tool calls to user in a compact format
    if (message.type === "assistant" && (message as any).message?.content?.[0]?.name) {
      const toolName = (message as any).message.content[0].name;
      const toolInput = (message as any).message.content[0].input;
      toolCallCount++;
      
      // Build compact tool display
      let toolDisplay = `  ${chalk.cyan(toolName)}`;
      
      // Add key argument for the tool
      if (toolInput) {
        if (toolInput.file_path) {
          toolDisplay += `(${chalk.green(toolInput.file_path)})`;
        } else if (toolInput.path) {
          toolDisplay += `(${chalk.green(toolInput.path)})`;
        } else if (toolInput.pattern) {
          toolDisplay += `(${chalk.green(`"${toolInput.pattern}"`)})`;
        } else if (toolInput.command) {
          const cmd = toolInput.command.length > 50 
            ? toolInput.command.substring(0, 50) + "..."
            : toolInput.command;
          toolDisplay += `(${chalk.green(cmd)})`;
        } else if (toolInput.query) {
          const q = toolInput.query.length > 30
            ? toolInput.query.substring(0, 30) + "..."
            : toolInput.query;
          toolDisplay += `(${chalk.green(`"${q}"`)})`;
        }
      }
      
      console.log(toolDisplay);
    }
    
    if (message.type === "result") {
      if (message.is_error) {
        throw new Error(
          (message as any).result ||
            "Claude SDK error during prompt generation",
        );
      }
      result = (message as any).result || "";
      break;
    }
  }
  } finally {
    // Clean up signal handlers
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
  }

  if (toolCallCount > 0) {
    console.log(chalk.gray(`  Analyzed codebase with ${toolCallCount} tool calls`));
  }

  if (!result) {
    throw new Error(
      "Failed to generate transformation prompt - no result received",
    );
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
  // Use process.cwd() as base for relative paths to ensure proper mocking in tests
  const sourceDir = sourceRepo && sourceRepo !== "./" 
    ? resolve(process.cwd(), sourceRepo) 
    : process.cwd();
  const repoMirrorDir = join(sourceDir, ".repomirror");

  // Create .repomirror directory
  await fs.mkdir(repoMirrorDir, { recursive: true });

  // Create prompt.md
  await fs.writeFile(join(repoMirrorDir, "prompt.md"), optimizedPrompt);

  // Get template directory - look for templates in the package
  const templateDir = await getTemplateDir();

  // Create sync.sh from template
  const syncTemplate = await fs.readFile(join(templateDir, "sync.sh.template"), "utf8");
  const syncScript = syncTemplate.replace(/\${targetRepo}/g, targetRepo);
  await fs.writeFile(join(repoMirrorDir, "sync.sh"), syncScript, {
    mode: 0o755,
  });

  // Create ralph.sh from template
  const ralphTemplate = await fs.readFile(join(templateDir, "ralph.sh.template"), "utf8");
  await fs.writeFile(join(repoMirrorDir, "ralph.sh"), ralphTemplate, {
    mode: 0o755,
  });

  // Create .gitignore from template
  const gitignoreTemplate = await fs.readFile(join(templateDir, "gitignore.template"), "utf8");
  await fs.writeFile(
    join(repoMirrorDir, ".gitignore"),
    gitignoreTemplate + "\n",
  );
}

async function getTemplateDir(): Promise<string> {
  // First try to find templates in the package dist (for published package)
  try {
    const packageRoot = path.dirname(path.dirname(__dirname)); // From dist/commands to project root
    const distTemplateDir = join(packageRoot, "dist", "templates");
    await fs.access(distTemplateDir);
    return distTemplateDir;
  } catch {
    // Fallback to src templates (for development and tests)
    const packageRoot = path.dirname(path.dirname(__dirname)); // From src/commands to project root  
    const srcTemplateDir = join(packageRoot, "src", "templates");
    try {
      await fs.access(srcTemplateDir);
      return srcTemplateDir;
    } catch {
      // If neither works, throw a more helpful error
      throw new Error(`Could not find templates in either dist/templates or src/templates. Package root: ${packageRoot}`);
    }
  }
}
