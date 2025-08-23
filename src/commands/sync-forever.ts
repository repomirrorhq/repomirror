import { execa } from "execa";
import chalk from "chalk";
import { join } from "path";
import { promises as fs } from "fs";

export async function syncForever(): Promise<void> {
  const ralphScript = join(process.cwd(), ".repomirror", "ralph.sh");

  try {
    // Check if ralph.sh exists
    await fs.access(ralphScript);
  } catch {
    console.error(
      chalk.red(
        "Error: .repomirror/ralph.sh not found. Run 'npx repomirror init' first.",
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
