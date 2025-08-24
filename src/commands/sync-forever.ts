import { execa } from "execa";
import chalk from "chalk";
import { join } from "path";
import { promises as fs } from "fs";
import { sync } from "./sync";

export async function syncForever(options?: { autoPush?: boolean }): Promise<void> {
  const ralphScript = join(process.cwd(), ".simonsays", "ralph.sh");
  const syncScript = join(process.cwd(), ".simonsays", "sync.sh");

  // Check if scripts exist
  let ralphExists = false;
  let syncExists = false;
  
  try {
    await fs.access(ralphScript);
    ralphExists = true;
  } catch {
    // ralph.sh doesn't exist
  }

  try {
    await fs.access(syncScript);
    syncExists = true;
  } catch {
    // sync.sh doesn't exist
  }

  // For strict backward compatibility: without --auto-push, always require ralph.sh
  if (!options?.autoPush && !ralphExists) {
    console.error(
      chalk.red(
        "Error: .simonsays/ralph.sh not found. Run 'npx simonsays init' first.",
      ),
    );
    process.exit(1);
  }

  // If auto-push is requested, we need to use the new sync() approach
  // If ralph.sh exists and no auto-push, use legacy approach
  if (options?.autoPush || !ralphExists) {
    if (!syncExists) {
      console.error(
        chalk.red(
          "Error: .simonsays/sync.sh not found. Run 'npx simonsays init' first.",
        ),
      );
      process.exit(1);
    }

    console.log(chalk.cyan("Running continuous sync..."));
    if (options?.autoPush) {
      console.log(chalk.cyan("Auto-push is enabled"));
    }
    console.log(chalk.yellow("Press Ctrl+C to stop"));

    let isRunning = true;

    // Handle graceful shutdown
    const signalHandler = () => {
      console.log(chalk.yellow("\nStopping continuous sync..."));
      isRunning = false;
    };

    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    try {
      while (isRunning) {
        try {
          await sync(options?.autoPush ? { autoPush: options.autoPush } : undefined);
          
          if (isRunning) {
            console.log(chalk.gray("===SLEEP==="));
            console.log(chalk.gray("looping"));
            
            // Sleep for 10 seconds, but check for stop condition every second
            for (let i = 0; i < 10 && isRunning; i++) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        } catch (error) {
          console.error(
            chalk.red(
              `Sync iteration failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          console.log(chalk.gray("Continuing with next iteration..."));
          
          // Sleep for 10 seconds before retrying
          for (let i = 0; i < 10 && isRunning; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    } finally {
      // Clean up signal handlers
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      console.log(chalk.yellow("Stopped by user"));
    }
  } else {
    // Use legacy ralph.sh approach
    if (!ralphExists) {
      console.error(
        chalk.red(
          "Error: .simonsays/ralph.sh not found. Run 'npx simonsays init' first.",
        ),
      );
      process.exit(1);
    }

    console.log(chalk.cyan("Running ralph.sh (continuous sync)..."));
    console.log(chalk.yellow("Press Ctrl+C to stop"));

    try {
      await execa("bash", [ralphScript], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
    } catch (error) {
      if (error instanceof Error && (error as any).signal === "SIGINT") {
        console.log(chalk.yellow("\nStopped by user"));
      } else {
        console.error(
          chalk.red(
            `Sync forever failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exit(1);
      }
    }
  }
}
