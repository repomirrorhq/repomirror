import { promises as fs } from "fs";
import { join } from "path";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import yaml from "yaml";

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

interface PushOptions {
  remote?: string;
  branch?: string;
  all?: boolean;
  dryRun?: boolean;
}

async function loadConfig(): Promise<RepoMirrorConfig | null> {
  try {
    const configPath = join(process.cwd(), "repomirror.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    return yaml.parse(configContent) as RepoMirrorConfig;
  } catch {
    return null;
  }
}

async function getGitStatus(targetRepo: string): Promise<{
  hasChanges: boolean;
  stagedFiles: string[];
  unstagedFiles: string[];
}> {
  try {
    // Check for staged changes
    const { stdout: stagedOutput } = await execa(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd: targetRepo },
    );
    const stagedFiles = stagedOutput.trim()
      ? stagedOutput.trim().split("\n")
      : [];

    // Check for unstaged changes
    const { stdout: unstagedOutput } = await execa(
      "git",
      ["diff", "--name-only"],
      { cwd: targetRepo },
    );
    const unstagedFiles = unstagedOutput.trim()
      ? unstagedOutput.trim().split("\n")
      : [];

    // Check for untracked files
    const { stdout: untrackedOutput } = await execa(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: targetRepo },
    );
    const untrackedFiles = untrackedOutput.trim()
      ? untrackedOutput.trim().split("\n")
      : [];

    const hasChanges =
      stagedFiles.length > 0 ||
      unstagedFiles.length > 0 ||
      untrackedFiles.length > 0;

    return {
      hasChanges,
      stagedFiles,
      unstagedFiles: [...unstagedFiles, ...untrackedFiles],
    };
  } catch (error) {
    throw new Error(`Failed to check git status: ${error}`);
  }
}

async function getSourceCommitHash(sourceRepo: string): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "HEAD"], {
      cwd: sourceRepo,
    });
    return stdout.trim().substring(0, 7); // Short hash
  } catch {
    return null; // Source repo might not be a git repository
  }
}

async function generateCommitMessage(
  config: RepoMirrorConfig,
  sourceCommitHash: string | null,
): Promise<string> {
  const prefix = config.push?.commit_prefix || "[repomirror]";
  const instructions = config.transformationInstructions;

  // Create a concise summary of transformation
  let summary = "Apply transformations";
  if (instructions.length < 80) {
    summary = instructions;
  } else {
    // Extract key transformation type from instructions
    const lowerInstructions = instructions.toLowerCase();
    if (
      lowerInstructions.includes("typescript") ||
      lowerInstructions.includes("ts")
    ) {
      summary = "Convert to TypeScript";
    } else if (lowerInstructions.includes("python")) {
      summary = "Convert to Python";
    } else if (lowerInstructions.includes("react")) {
      summary = "Convert to React";
    } else if (lowerInstructions.includes("vue")) {
      summary = "Convert to Vue";
    } else {
      summary = "Apply code transformations";
    }
  }

  let commitMessage = `${prefix} ${summary}`;

  if (sourceCommitHash) {
    commitMessage += ` (source: ${sourceCommitHash})`;
  }

  return commitMessage;
}

async function stageAndCommitChanges(
  targetRepo: string,
  commitMessage: string,
): Promise<void> {
  const spinner = ora("Staging changes...").start();

  try {
    // Add all changes to staging
    await execa("git", ["add", "."], { cwd: targetRepo });
    spinner.succeed("Staged all changes");

    // Create commit
    const commitSpinner = ora("Creating commit...").start();
    await execa("git", ["commit", "-m", commitMessage], { cwd: targetRepo });
    commitSpinner.succeed("Created commit successfully");
  } catch (error) {
    spinner.fail("Failed to stage and commit changes");
    throw new Error(`Git commit failed: ${error}`);
  }
}

async function pushToRemote(
  targetRepo: string,
  remoteName: string,
  remoteBranch: string,
  dryRun: boolean = false,
): Promise<void> {
  const action = dryRun ? "dry-run push to" : "push to";
  const spinner = ora(
    `Starting ${action} ${remoteName}/${remoteBranch}...`,
  ).start();

  try {
    const args = ["push"];
    if (dryRun) {
      args.push("--dry-run");
    }
    args.push(remoteName, remoteBranch);

    const { stdout, stderr } = await execa("git", args, {
      cwd: targetRepo,
      timeout: 60000, // 60 second timeout
    });

    if (dryRun) {
      spinner.succeed(`Dry run completed for ${remoteName}/${remoteBranch}`);
      if (stdout) {
        console.log(chalk.gray("Dry run output:"));
        console.log(chalk.gray(stdout));
      }
    } else {
      spinner.succeed(`Successfully pushed to ${remoteName}/${remoteBranch}`);
    }

    // Show any informational output from git push
    if (stderr && !stderr.includes("error") && !stderr.includes("fatal")) {
      console.log(chalk.gray(stderr));
    }
  } catch (error) {
    const actionText = dryRun ? "Dry run failed" : "Push failed";
    spinner.fail(`${actionText} for ${remoteName}/${remoteBranch}`);

    if (error instanceof Error) {
      // Check for common authentication issues
      const errorMessage = error.message.toLowerCase();
      if (
        errorMessage.includes("authentication failed") ||
        errorMessage.includes("permission denied")
      ) {
        console.log(chalk.yellow("\n🔐 Authentication Issue Detected:"));
        console.log(
          chalk.gray("• For HTTPS: Check your GitHub token or credentials"),
        );
        console.log(
          chalk.gray(
            "• For SSH: Ensure your SSH key is added to your GitHub account",
          ),
        );
        console.log(
          chalk.gray("• Test with: git push from the target directory"),
        );
      } else if (errorMessage.includes("timeout")) {
        console.log(
          chalk.yellow("\n⏰ Push timed out - check your network connection"),
        );
      } else if (errorMessage.includes("rejected")) {
        console.log(
          chalk.yellow("\n🚫 Push rejected - you may need to pull first"),
        );
        console.log(chalk.gray("• Try: git pull from the target directory"));
      }
    }

    throw error;
  }
}

async function performPush(
  config: RepoMirrorConfig,
  options: PushOptions,
): Promise<void> {
  const { targetRepo } = config;

  // Verify target directory exists and is a git repository
  try {
    await fs.access(targetRepo);
    await execa("git", ["rev-parse", "--git-dir"], { cwd: targetRepo });
  } catch {
    console.error(
      chalk.red(
        `Error: Target directory ${targetRepo} is not a valid git repository`,
      ),
    );
    process.exit(1);
  }

  // Check git status
  const gitStatus = await getGitStatus(targetRepo);

  if (!gitStatus.hasChanges) {
    console.log(chalk.yellow("No changes to commit"));
    return;
  }

  // Show what changes will be committed
  console.log(chalk.cyan("Changes to be pushed:"));
  if (gitStatus.stagedFiles.length > 0) {
    console.log(chalk.green("  Staged files:"));
    gitStatus.stagedFiles.forEach((file) =>
      console.log(chalk.green(`    + ${file}`)),
    );
  }
  if (gitStatus.unstagedFiles.length > 0) {
    console.log(chalk.yellow("  Modified/untracked files:"));
    gitStatus.unstagedFiles.forEach((file) =>
      console.log(chalk.yellow(`    M ${file}`)),
    );
  }
  console.log();

  // Get source commit hash for commit message
  const sourceCommitHash = await getSourceCommitHash(config.sourceRepo);

  // Generate commit message
  const commitMessage = await generateCommitMessage(config, sourceCommitHash);
  console.log(chalk.gray(`Commit message: ${commitMessage}\n`));

  // If dry run, skip committing
  if (!options.dryRun) {
    // Stage and commit changes
    await stageAndCommitChanges(targetRepo, commitMessage);
  }

  // Determine which remotes to push to
  const remotesToPush: Array<{ name: string; branch: string }> = [];

  if (options.all) {
    // Push to all configured remotes
    if (config.remotes) {
      Object.entries(config.remotes).forEach(([name, remote]) => {
        remotesToPush.push({ name, branch: remote.branch });
      });
    }
  } else {
    // Push to specific or default remote
    const remoteName = options.remote || config.push?.default_remote;
    const remoteBranch = options.branch || config.push?.default_branch;

    if (!remoteName) {
      console.error(
        chalk.red(
          "Error: No remote specified and no default remote configured",
        ),
      );
      console.log(
        chalk.gray(
          "Use --remote <name> or add a default remote with: npx repomirror remote add",
        ),
      );
      process.exit(1);
    }

    if (!config.remotes?.[remoteName]) {
      console.error(chalk.red(`Error: Remote '${remoteName}' not found`));
      console.log(
        chalk.gray("List configured remotes with: npx repomirror remote list"),
      );
      process.exit(1);
    }

    const branch = remoteBranch || config.remotes[remoteName].branch;
    remotesToPush.push({ name: remoteName, branch });
  }

  if (remotesToPush.length === 0) {
    console.log(chalk.yellow("No remotes configured for push"));
    console.log(
      chalk.gray("Add a remote with: npx repomirror remote add <name> <url>"),
    );
    return;
  }

  // Push to each remote
  const errors: string[] = [];
  for (const remote of remotesToPush) {
    try {
      await pushToRemote(
        targetRepo,
        remote.name,
        remote.branch,
        options.dryRun,
      );
    } catch (error) {
      errors.push(`${remote.name}/${remote.branch}: ${error}`);
    }
  }

  // Report results
  if (errors.length === 0) {
    const action = options.dryRun
      ? "Dry run completed"
      : "All pushes completed successfully";
    console.log(chalk.green(`\n✅ ${action}`));
  } else {
    console.log(chalk.red("\n❌ Some pushes failed:"));
    errors.forEach((error) => console.log(chalk.red(`  • ${error}`)));
    process.exit(1);
  }
}

export async function push(options: PushOptions = {}): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error(
      chalk.red(
        "Error: repomirror.yaml not found. Run 'npx repomirror init' first.",
      ),
    );
    process.exit(1);
  }

  if (!config.remotes || Object.keys(config.remotes).length === 0) {
    console.error(chalk.red("Error: No remotes configured"));
    console.log(
      chalk.gray("Add a remote with: npx repomirror remote add <name> <url>"),
    );
    process.exit(1);
  }

  try {
    await performPush(config, options);
  } catch (error) {
    console.error(
      chalk.red(
        `Push failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(1);
  }
}
