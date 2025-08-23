import * as fs from "fs-extra";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";

const defaultConfig = `# RepomMirror Configuration
# This file configures how repositories are synced and transformed

# Source repository configuration
source:
  type: git
  url: ""
  branch: main
  
# Target repository configuration  
target:
  type: git
  url: ""
  branch: main

# Transformation rules
transforms:
  - type: file-rename
    patterns:
      - from: "*.old"
        to: "*.new"
        
  - type: content-replace
    files: "**/*.md"
    replacements:
      - from: "old-text"
        to: "new-text"

# Sync configuration
sync:
  # How often to check for changes (in minutes)
  interval: 60
  
  # Files/directories to ignore
  ignore:
    - "node_modules/"
    - ".git/"
    - "*.log"
    - "tmp/"
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
