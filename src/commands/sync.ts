import { execa } from "execa";
import chalk from "chalk";
import { join } from "path";
import { promises as fs } from "fs";
import yaml from "yaml";
import { push } from "./push";

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
    const configPath = join(process.cwd(), "simonsays.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    return yaml.parse(configContent) as RepoMirrorConfig;
  } catch {
    return null;
  }
}

async function performAutoPush(config: RepoMirrorConfig, cliAutoPush: boolean): Promise<void> {
  if (!cliAutoPush && !config.remotes) {
    return;
  }

  // Find remotes with auto_push enabled
  const autoPushRemotes: string[] = [];
  if (config.remotes) {
    for (const [remoteName, remoteConfig] of Object.entries(config.remotes)) {
      if (cliAutoPush || remoteConfig.auto_push) {
        autoPushRemotes.push(remoteName);
      }
    }
  }

  if (autoPushRemotes.length === 0) {
    return;
  }

  console.log(chalk.cyan("\n🚀 Auto-push enabled - pushing to configured remotes..."));

  try {
    if (cliAutoPush) {
      // Push to all remotes when --auto-push is used
      await push({ all: true });
    } else {
      // Push only to remotes with auto_push enabled
      for (const remoteName of autoPushRemotes) {
        await push({ remote: remoteName });
      }
    }
    console.log(chalk.green("✅ Auto-push completed successfully"));
  } catch (error) {
    // Log the error but don't break the sync workflow
    console.log(chalk.yellow("⚠️  Auto-push failed, but sync completed successfully:"));
    console.log(chalk.red(`   ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.gray("   You can manually push using: npx simonsays push"));
  }
}

export async function sync(options?: { autoPush?: boolean }): Promise<void> {
  const syncScript = join(process.cwd(), ".simonsays", "sync.sh");

  try {
    // Check if sync.sh exists
    await fs.access(syncScript);
  } catch {
    console.error(
      chalk.red(
        "Error: .simonsays/sync.sh not found. Run 'npx simonsays init' first.",
      ),
    );
    process.exit(1);
  }

  console.log(chalk.cyan("Running sync.sh..."));

  const subprocess = execa("bash", [syncScript], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  // Handle graceful shutdown for subprocess
  const signalHandler = () => {
    console.log(chalk.yellow("\nStopping sync..."));
    subprocess.kill("SIGINT");
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  try {
    await subprocess;
    console.log(chalk.green("Sync completed successfully"));

    // Check for auto-push after successful sync
    const config = await loadConfig();
    if (config && (options?.autoPush || config.remotes)) {
      await performAutoPush(config, options?.autoPush || false);
    }
  } catch (error) {
    // Clean up signal handlers
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    
    if (error instanceof Error && (error as any).signal === "SIGINT") {
      console.log(chalk.yellow("\nSync stopped by user"));
      process.exit(0);
    }
    
    console.error(
      chalk.red(
        `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(1);
  } finally {
    // Clean up signal handlers
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
  }
}
