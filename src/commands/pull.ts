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

interface PullOptions {
  sourceOnly?: boolean;
  syncAfter?: boolean;
  check?: boolean;
}

async function loadConfig(): Promise<RepoMirrorConfig | null> {
  try {
    const configPath = join(process.cwd(), "simonsays.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    return yaml.parse(configContent) as RepoMirrorConfig;
  } catch {
    return null;
  }
}

async function checkSourceRepoStatus(sourceRepo: string): Promise<{
  isGitRepo: boolean;
  hasRemotes: boolean;
  currentBranch: string | null;
  hasUncommittedChanges: boolean;
}> {
  try {
    // Check if it's a git repository
    await execa("git", ["rev-parse", "--git-dir"], { cwd: sourceRepo });

    // Get current branch
    const { stdout: branchOutput } = await execa(
      "git",
      ["branch", "--show-current"],
      { cwd: sourceRepo },
    );
    const currentBranch = branchOutput.trim();

    // Check for remotes
    const { stdout: remotesOutput } = await execa("git", ["remote"], {
      cwd: sourceRepo,
    });
    const hasRemotes = remotesOutput.trim().length > 0;

    // Check for uncommitted changes
    const { stdout: statusOutput } = await execa(
      "git",
      ["status", "--porcelain"],
      { cwd: sourceRepo },
    );
    const hasUncommittedChanges = statusOutput.trim().length > 0;

    return {
      isGitRepo: true,
      hasRemotes,
      currentBranch,
      hasUncommittedChanges,
    };
  } catch {
    return {
      isGitRepo: false,
      hasRemotes: false,
      currentBranch: null,
      hasUncommittedChanges: false,
    };
  }
}

async function getRemoteChangesSummary(
  sourceRepo: string,
  remoteName: string,
  remoteBranch: string,
): Promise<{
  hasNewCommits: boolean;
  commitCount: number;
  commitMessages: string[];
}> {
  try {
    // Fetch latest changes from remote
    await execa("git", ["fetch", remoteName], { cwd: sourceRepo });

    // Check for new commits
    const { stdout: countOutput } = await execa(
      "git",
      ["rev-list", "--count", `HEAD..${remoteName}/${remoteBranch}`],
      { cwd: sourceRepo },
    );
    const commitCount = parseInt(countOutput.trim(), 10) || 0;

    if (commitCount === 0 || isNaN(commitCount)) {
      return {
        hasNewCommits: false,
        commitCount: 0,
        commitMessages: [],
      };
    }

    // Get commit messages for preview
    const { stdout: logOutput } = await execa(
      "git",
      [
        "log",
        "--oneline",
        "--no-merges",
        `-${Math.min(commitCount, 5)}`, // Show up to 5 commits
        `HEAD..${remoteName}/${remoteBranch}`,
      ],
      { cwd: sourceRepo },
    );

    const commitMessages = logOutput.trim().split("\n").filter(Boolean);

    return {
      hasNewCommits: true,
      commitCount,
      commitMessages,
    };
  } catch (error) {
    throw new Error(`Failed to check for remote changes: ${error}`);
  }
}

async function pullSourceChanges(
  sourceRepo: string,
  remoteName: string,
  remoteBranch: string,
): Promise<{ success: boolean; conflictsDetected: boolean }> {
  const spinner = ora(
    `Pulling changes from ${remoteName}/${remoteBranch}...`,
  ).start();

  try {
    // Attempt to pull changes
    const { stdout, stderr } = await execa(
      "git",
      ["pull", remoteName, remoteBranch],
      { cwd: sourceRepo },
    );

    // Check for merge conflicts
    const conflictsDetected =
      stderr.includes("CONFLICT") ||
      stdout.includes("CONFLICT") ||
      stderr.includes("Automatic merge failed");

    if (conflictsDetected) {
      spinner.fail("Pull completed with merge conflicts");
      return { success: false, conflictsDetected: true };
    }

    spinner.succeed(`Successfully pulled from ${remoteName}/${remoteBranch}`);

    // Show pull summary if there's useful information
    if (stdout && !stdout.includes("Already up to date")) {
      console.log(chalk.gray("Pull summary:"));
      console.log(chalk.gray(stdout.split("\n").slice(0, 3).join("\n")));
    }

    return { success: true, conflictsDetected: false };
  } catch (error) {
    spinner.fail(`Failed to pull from ${remoteName}/${remoteBranch}`);

    if (error instanceof Error) {
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
      } else if (errorMessage.includes("couldn't find remote ref")) {
        console.log(
          chalk.yellow(
            `\n🌿 Branch '${remoteBranch}' not found on remote '${remoteName}'`,
          ),
        );
        console.log(
          chalk.gray("• Check the branch name in your simonsays.yaml"),
        );
        console.log(
          chalk.gray("• List available branches with: git ls-remote --heads"),
        );
      }
    }

    throw error;
  }
}

async function triggerSync(syncAfter: boolean): Promise<void> {
  const syncScript = join(process.cwd(), ".simonsays", "sync.sh");
  const ralphScript = join(process.cwd(), ".simonsays", "ralph.sh");

  try {
    if (syncAfter) {
      // Check if ralph.sh exists for continuous sync
      await fs.access(ralphScript);
      console.log(chalk.cyan("\n🔄 Starting continuous sync (ralph.sh)..."));
      console.log(chalk.yellow("Press Ctrl+C to stop"));

      await execa("bash", [ralphScript], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
    } else {
      // Check if sync.sh exists for single sync
      await fs.access(syncScript);
      console.log(chalk.cyan("\n🔄 Running single sync (sync.sh)..."));

      await execa("bash", [syncScript], {
        stdio: "inherit",
        cwd: process.cwd(),
      });

      console.log(chalk.green("✅ Sync completed"));
    }
  } catch (error) {
    if (error instanceof Error && (error as any).signal === "SIGINT") {
      console.log(chalk.yellow("\nStopped by user"));
    } else {
      throw new Error(`Sync failed: ${error}`);
    }
  }
}

async function performPull(
  config: RepoMirrorConfig,
  options: PullOptions,
): Promise<void> {
  const { sourceRepo } = config;

  // Verify source directory exists
  try {
    await fs.access(sourceRepo);
  } catch {
    console.error(
      chalk.red(`Error: Source directory ${sourceRepo} does not exist`),
    );
    process.exit(1);
  }

  // Check source repository status
  const repoStatus = await checkSourceRepoStatus(sourceRepo);

  if (!repoStatus.isGitRepo) {
    console.error(
      chalk.red(
        `Error: Source directory ${sourceRepo} is not a git repository`,
      ),
    );
    process.exit(1);
  }

  if (!repoStatus.hasRemotes) {
    console.error(
      chalk.red("Error: Source repository has no configured remotes"),
    );
    console.log(chalk.gray("Add a remote with: git remote add <name> <url>"));
    process.exit(1);
  }

  if (repoStatus.hasUncommittedChanges) {
    console.log(chalk.yellow("⚠️  Source repository has uncommitted changes"));
    console.log(
      chalk.gray("Consider committing or stashing changes before pulling"),
    );
    console.log();
  }

  // Determine remote and branch to pull from
  const remoteName = config.pull?.source_remote || "upstream";
  const remoteBranch = config.pull?.source_branch || "main";

  console.log(
    chalk.cyan(`📡 Checking for changes from ${remoteName}/${remoteBranch}...`),
  );

  try {
    // Get summary of remote changes
    const changesSummary = await getRemoteChangesSummary(
      sourceRepo,
      remoteName,
      remoteBranch,
    );

    if (!changesSummary.hasNewCommits) {
      console.log(chalk.green("✅ Source repository is already up to date"));
      return;
    }

    // Show preview of incoming changes
    console.log(
      chalk.cyan(`\n📥 ${changesSummary.commitCount} new commit(s) available:`),
    );
    changesSummary.commitMessages.forEach((message) => {
      console.log(chalk.gray(`  • ${message}`));
    });

    if (changesSummary.commitCount > changesSummary.commitMessages.length) {
      const remaining =
        changesSummary.commitCount - changesSummary.commitMessages.length;
      console.log(chalk.gray(`  ... and ${remaining} more commit(s)`));
    }
    console.log();

    // If this is just a check, return here
    if (options.check) {
      console.log(
        chalk.blue(
          "🔍 Check complete - use 'npx simonsays pull' to apply changes",
        ),
      );
      return;
    }

    // Pull the changes
    const pullResult = await pullSourceChanges(
      sourceRepo,
      remoteName,
      remoteBranch,
    );

    if (!pullResult.success) {
      if (pullResult.conflictsDetected) {
        console.log(chalk.red("\n❌ Merge conflicts detected"));
        console.log(chalk.yellow("Please resolve conflicts manually:"));
        console.log(chalk.gray("1. Navigate to source repository"));
        console.log(chalk.gray("2. Resolve conflicts in affected files"));
        console.log(chalk.gray("3. Run: git add . && git commit"));
        console.log(chalk.gray("4. Re-run: npx simonsays pull"));
        process.exit(1);
      }
      return;
    }

    // Trigger sync if requested or configured
    const shouldSync =
      options.syncAfter || (config.pull?.auto_sync && !options.sourceOnly);

    if (shouldSync && !options.sourceOnly) {
      await triggerSync(!!options.syncAfter);
    } else if (!options.sourceOnly) {
      console.log(chalk.blue("\n💡 Source changes pulled successfully"));
      console.log(
        chalk.gray("Run 'npx simonsays sync' to apply transformations"),
      );
    }
  } catch (error) {
    throw new Error(`Pull operation failed: ${error}`);
  }
}

export async function pull(options: PullOptions = {}): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error(
      chalk.red(
        "Error: simonsays.yaml not found. Run 'npx simonsays init' first.",
      ),
    );
    process.exit(1);
  }

  try {
    await performPull(config, options);
  } catch (error) {
    console.error(
      chalk.red(
        `Pull failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(1);
  }
}
