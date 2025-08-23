import * as fs from "fs-extra";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";

const defaultConfig = `# RepoMirror Configuration
# This file configures how repositories are synced and transformed

syncs:
  - source:
      path: ./
    target:
      repo: ../assistant-ui-vuejs
    instructions: |
      translate the react repo to vuejs
    agent: claude_code # or amp
`;

export async function init(): Promise<void> {
  const spinner = ora("Initializing repomirror configuration").start();

  try {
    const configPath = path.join(process.cwd(), "repomirror.yaml");

    if (await fs.pathExists(configPath)) {
      spinner.fail("Configuration file already exists");
      console.log(
        chalk.yellow("repomirror.yaml already exists in current directory"),
      );
      return;
    }

    await fs.writeFile(configPath, defaultConfig, "utf8");

    spinner.succeed("Configuration file created");
    console.log(chalk.green("✓ Created repomirror.yaml"));
    console.log(
      chalk.blue(
        "Edit the configuration file to set up your repositories and transformation rules",
      ),
    );
  } catch (error) {
    spinner.fail("Failed to create configuration file");
    console.error(chalk.red("Error creating configuration:"), error);
    process.exit(1);
  }
}
