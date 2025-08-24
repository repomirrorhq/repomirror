import { promises as fs } from "fs";
import { join } from "path";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import inquirer from "inquirer";

interface DispatchSyncOptions {
  yes?: boolean;
  quiet?: boolean;
}

async function workflowExists(): Promise<boolean> {
  try {
    const workflowPath = join(process.cwd(), ".github", "workflows", "repomirror.yml");
    await fs.access(workflowPath);
    return true;
  } catch {
    return false;
  }
}

async function getRepoInfo(): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execa("git", ["config", "--get", "remote.origin.url"]);
    const url = stdout.trim();
    
    // Parse GitHub URL to extract owner/repo
    let match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!match) {
      return null;
    }
    
    return {
      owner: match[1],
      repo: match[2],
    };
  } catch {
    return null;
  }
}

async function checkGhCliInstalled(): Promise<boolean> {
  try {
    await execa("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function dispatchWorkflow(owner: string, repo: string, quiet: boolean): Promise<void> {
  const spinner = quiet ? null : ora("Dispatching workflow...").start();

  try {
    const { stdout } = await execa("gh", [
      "workflow",
      "run",
      "repomirror.yml",
      "--repo", 
      `${owner}/${repo}`,
    ]);

    if (spinner) {
      spinner.succeed("Workflow dispatched successfully");
    } else if (!quiet) {
      console.log(chalk.green("✅ Workflow dispatched successfully"));
    }

    // Show workflow run URL if available
    if (!quiet && stdout) {
      console.log(chalk.gray(stdout));
    }
  } catch (error) {
    if (spinner) {
      spinner.fail("Failed to dispatch workflow");
    }

    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      
      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        console.error(chalk.red("Error: Workflow 'repomirror.yml' not found in the repository"));
        console.log(chalk.gray("Make sure the workflow file exists and you have access to the repository"));
      } else if (errorMessage.includes("authentication") || errorMessage.includes("permission")) {
        console.error(chalk.red("Error: Authentication failed"));
        console.log(chalk.gray("Make sure you're authenticated with GitHub CLI:"));
        console.log(chalk.gray("  gh auth login"));
      } else if (errorMessage.includes("workflow_dispatch")) {
        console.error(chalk.red("Error: Workflow does not support manual dispatch"));
        console.log(chalk.gray("Make sure the workflow has 'workflow_dispatch:' trigger"));
      } else {
        console.error(chalk.red(`Error dispatching workflow: ${error.message}`));
      }
    } else {
      console.error(chalk.red(`Error dispatching workflow: ${String(error)}`));
    }

    throw error;
  }
}

export async function dispatchSync(options: DispatchSyncOptions = {}): Promise<void> {
  // Validate flag combination
  if (options.quiet && !options.yes) {
    console.error(chalk.red("Error: --quiet cannot be used without --yes"));
    console.log(chalk.gray("Use --quiet and --yes together, or use --yes alone"));
    process.exit(1);
  }

  // Check if repomirror.yml workflow exists
  const exists = await workflowExists();
  if (!exists) {
    console.error(chalk.red("Error: .github/workflows/repomirror.yml not found"));
    console.log(chalk.gray("Run 'npx repomirror setup-github-pr-sync' to create the workflow first"));
    process.exit(1);
  }

  // Check if gh CLI is installed
  const ghInstalled = await checkGhCliInstalled();
  if (!ghInstalled) {
    console.error(chalk.red("Error: GitHub CLI (gh) is not installed"));
    console.log(chalk.gray("Install it from: https://cli.github.com/"));
    process.exit(1);
  }

  // Get repository information
  const repoInfo = await getRepoInfo();
  if (!repoInfo) {
    console.error(chalk.red("Error: Could not determine GitHub repository"));
    console.log(chalk.gray("Make sure you're in a git repository with a GitHub origin remote"));
    process.exit(1);
  }

  const { owner, repo } = repoInfo;

  // Show what's going to happen (unless quiet)
  if (!options.quiet) {
    console.log(chalk.cyan("This will dispatch the repomirror.yml workflow to run sync-one command"));
    console.log(chalk.gray(`Repository: ${owner}/${repo}`));
    console.log(chalk.gray("Workflow: .github/workflows/repomirror.yml"));
    console.log();
  }

  // Get confirmation (unless --yes flag is used)
  if (!options.yes) {
    const { shouldProceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldProceed",
        message: "Do you want to dispatch the workflow?",
        default: true,
      },
    ]);

    if (!shouldProceed) {
      console.log(chalk.yellow("Operation cancelled"));
      process.exit(0);
    }
  }

  try {
    await dispatchWorkflow(owner, repo, options.quiet || false);
    
    if (!options.quiet) {
      console.log(chalk.green("\n✅ Workflow dispatch completed"));
      console.log(chalk.gray("You can monitor the workflow run at:"));
      console.log(chalk.gray(`https://github.com/${owner}/${repo}/actions`));
    }
  } catch (error) {
    console.error(
      chalk.red(
        `Dispatch failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
}