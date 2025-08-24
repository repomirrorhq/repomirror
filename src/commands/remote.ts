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

async function loadConfig(): Promise<RepoMirrorConfig | null> {
  try {
    const configPath = join(process.cwd(), "repomirror.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    return yaml.parse(configContent) as RepoMirrorConfig;
  } catch {
    return null;
  }
}

async function saveConfig(config: RepoMirrorConfig): Promise<void> {
  const configPath = join(process.cwd(), "repomirror.yaml");
  const configContent = yaml.stringify(config);
  await fs.writeFile(configPath, configContent, "utf-8");
}

async function validateRemoteUrl(url: string): Promise<boolean> {
  try {
    // Basic URL validation
    new URL(url);

    // Check if it's a valid git URL (basic patterns)
    const gitUrlPattern = /^(https?:\/\/|git@).+\.git$/i;
    const githubPattern = /^https?:\/\/github\.com\/.+\/.+/i;

    return gitUrlPattern.test(url) || githubPattern.test(url);
  } catch {
    return false;
  }
}

export async function remoteAdd(
  name: string,
  url: string,
  branch = "main",
): Promise<void> {
  if (!name || !url) {
    console.error(chalk.red("Error: Remote name and URL are required"));
    process.exit(1);
  }

  // Validate remote URL
  if (!(await validateRemoteUrl(url))) {
    console.error(chalk.red(`Error: Invalid git URL: ${url}`));
    console.log(
      chalk.gray(
        "Expected format: https://github.com/user/repo.git or git@github.com:user/repo.git",
      ),
    );
    process.exit(1);
  }

  const config = await loadConfig();
  if (!config) {
    console.error(
      chalk.red(
        "Error: repomirror.yaml not found. Run 'npx repomirror init' first.",
      ),
    );
    process.exit(1);
  }

  // Initialize remotes object if it doesn't exist
  if (!config.remotes) {
    config.remotes = {};
  }

  // Check if remote already exists
  if (config.remotes[name]) {
    console.error(chalk.red(`Error: Remote '${name}' already exists`));
    console.log(chalk.gray(`Current URL: ${config.remotes[name].url}`));
    console.log(
      chalk.gray(
        "Use 'npx repomirror remote remove <name>' to remove it first",
      ),
    );
    process.exit(1);
  }

  // Test remote accessibility (optional, non-blocking)
  const spinner = ora(`Testing remote accessibility for ${name}...`).start();
  try {
    // Try to ls-remote to verify the URL is accessible
    await execa("git", ["ls-remote", "--heads", url], { timeout: 10000 });
    spinner.succeed(`Remote ${name} is accessible`);
  } catch (error) {
    spinner.warn(`Warning: Could not verify remote accessibility`);
    console.log(
      chalk.gray(`  This might be due to authentication or network issues`),
    );
    console.log(
      chalk.gray(
        `  Remote will be added anyway - ensure you have proper access`,
      ),
    );
  }

  // Add remote to configuration
  config.remotes[name] = {
    url,
    branch,
    auto_push: false,
  };

  // Set as default remote if it's the first one
  if (!config.push) {
    config.push = {};
  }
  if (!config.push.default_remote) {
    config.push.default_remote = name;
  }
  if (!config.push.default_branch) {
    config.push.default_branch = branch;
  }
  if (!config.push.commit_prefix) {
    config.push.commit_prefix = "[repomirror]";
  }

  await saveConfig(config);

  console.log(chalk.green(`✅ Added remote '${name}'`));
  console.log(chalk.gray(`   URL: ${url}`));
  console.log(chalk.gray(`   Branch: ${branch}`));

  if (config.push.default_remote === name) {
    console.log(chalk.gray(`   Set as default remote for push operations`));
  }
}

export async function remoteList(): Promise<void> {
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
    console.log(chalk.yellow("No remotes configured"));
    console.log(
      chalk.gray("Add a remote with: npx repomirror remote add <name> <url>"),
    );
    return;
  }

  console.log(chalk.cyan("Configured remotes:"));
  console.log();

  Object.entries(config.remotes).forEach(([name, remote]) => {
    const isDefault = config.push?.default_remote === name;
    const prefix = isDefault ? chalk.green("* ") : "  ";

    console.log(`${prefix}${chalk.bold(name)}`);
    console.log(`    URL: ${remote.url}`);
    console.log(`    Branch: ${remote.branch}`);
    console.log(`    Auto-push: ${remote.auto_push ? "enabled" : "disabled"}`);

    if (isDefault) {
      console.log(chalk.gray("    (default remote)"));
    }
    console.log();
  });

  if (config.push) {
    console.log(chalk.gray("Push settings:"));
    console.log(
      chalk.gray(`  Default remote: ${config.push.default_remote || "none"}`),
    );
    console.log(
      chalk.gray(`  Default branch: ${config.push.default_branch || "none"}`),
    );
    console.log(
      chalk.gray(
        `  Commit prefix: ${config.push.commit_prefix || "[repomirror]"}`,
      ),
    );
  }
}

export async function remoteRemove(name: string): Promise<void> {
  if (!name) {
    console.error(chalk.red("Error: Remote name is required"));
    process.exit(1);
  }

  const config = await loadConfig();
  if (!config) {
    console.error(
      chalk.red(
        "Error: repomirror.yaml not found. Run 'npx repomirror init' first.",
      ),
    );
    process.exit(1);
  }

  if (!config.remotes || !config.remotes[name]) {
    console.error(chalk.red(`Error: Remote '${name}' not found`));
    console.log(chalk.gray("List remotes with: npx repomirror remote list"));
    process.exit(1);
  }

  const remote = config.remotes[name];
  delete config.remotes[name];

  // Update default remote if we're removing it
  if (config.push?.default_remote === name) {
    const remainingRemotes = Object.keys(config.remotes);
    if (remainingRemotes.length > 0) {
      config.push.default_remote = remainingRemotes[0];
      console.log(
        chalk.yellow(`Updated default remote to '${remainingRemotes[0]}'`),
      );
    } else {
      delete config.push.default_remote;
      console.log(chalk.yellow("No default remote (no remotes remaining)"));
    }
  }

  await saveConfig(config);

  console.log(chalk.green(`✅ Removed remote '${name}'`));
  console.log(chalk.gray(`   URL: ${remote.url}`));
}

export async function remote(action: string, ...args: string[]): Promise<void> {
  switch (action) {
    case "add":
      if (args.length < 2) {
        console.error(
          chalk.red("Usage: npx repomirror remote add <name> <url> [branch]"),
        );
        process.exit(1);
      }
      await remoteAdd(args[0], args[1], args[2]);
      break;

    case "list":
      await remoteList();
      break;

    case "remove":
    case "rm":
      if (args.length < 1) {
        console.error(chalk.red("Usage: npx repomirror remote remove <name>"));
        process.exit(1);
      }
      await remoteRemove(args[0]);
      break;

    default:
      console.error(chalk.red(`Unknown remote action: ${action}`));
      console.log(chalk.gray("Available actions:"));
      console.log(
        chalk.gray("  add <name> <url> [branch] - Add a remote repository"),
      );
      console.log(
        chalk.gray("  list                     - List configured remotes"),
      );
      console.log(chalk.gray("  remove <name>            - Remove a remote"));
      process.exit(1);
  }
}
