import { execa } from "execa";
import chalk from "chalk";
import { join } from "path";
import { promises as fs } from "fs";

export async function sync(): Promise<void> {
  const syncScript = join(process.cwd(), ".repomirror", "sync.sh");

  try {
    // Check if sync.sh exists
    await fs.access(syncScript);
  } catch {
    console.error(
      chalk.red(
        "Error: .repomirror/sync.sh not found. Run 'npx repomirror init' first.",
      ),
    );
    process.exit(1);
  }

  console.log(chalk.cyan("Running sync.sh..."));

  try {
    await execa("bash", [syncScript], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    console.log(chalk.green("Sync completed successfully"));
  } catch (error) {
    console.error(
      chalk.red(
        `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(1);
  }
}
