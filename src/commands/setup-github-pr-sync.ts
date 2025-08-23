import { promises as fs } from "fs";
import { join, resolve } from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import yaml from "yaml";

interface SetupGithubPrSyncOptions {
  targetRepo?: string;
  timesToLoop?: number;
  overwrite?: boolean;
}

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
  "github-pr-sync"?: {
    targetRepo?: string;
    timesToLoop?: number;
  };
}

const DEFAULT_WORKFLOW = `name: RepoMirror PR Sync

on:
  workflow_dispatch: # Allow manual trigger
  push:
    branches: [ main ]
    paths:
      - '.repomirror/**'
      - 'repomirror.yaml'

jobs:
  sync:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout source repository
      uses: actions/checkout@v4
      with:
        path: source
    
    - name: Checkout target repository  
      uses: actions/checkout@v4
      with:
        repository: {TARGET_REPO}
        token: $\{{ secrets.GITHUB_TOKEN }}
        path: target
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    
    - name: Install repomirror
      run: npm install -g repomirror
    
    - name: Setup Claude Code
      env:
        ANTHROPIC_API_KEY: $\{{ secrets.ANTHROPIC_API_KEY }}
      run: |
        # Setup Claude Code with API key
        echo "Setting up Claude Code..."
        # Configure Claude Code authentication for CI
        mkdir -p ~/.config/claude
        echo "api_key = \\"$ANTHROPIC_API_KEY\\"" > ~/.config/claude/config
    
    - name: Run RepoMirror sync loop
      working-directory: source
      env:
        SKIP_CLAUDE_TEST: true # Skip interactive Claude test in CI
      run: |
        # Run the sync-one command in a loop {TIMES_TO_LOOP} times
        for i in $(seq 1 {TIMES_TO_LOOP}); do
          echo "=== Sync iteration $i of {TIMES_TO_LOOP} ==="
          npx repomirror sync-one --auto-push || echo "Sync iteration $i failed, continuing..."
          if [ $i -lt {TIMES_TO_LOOP} ]; then
            echo "Sleeping 30 seconds before next iteration..."
            sleep 30
          fi
        done
    
    - name: Push final changes to target
      working-directory: target
      run: |
        git config user.name "GitHub Actions"
        git config user.email "actions@github.com"
        
        if [ -n "$(git status --porcelain)" ]; then
          git add -A
          git commit -m "Automated PR sync from source repository [$(date)]"
          git push
        else
          echo "No changes to push"
        fi
`;

async function loadExistingConfig(): Promise<Partial<RepoMirrorConfig> | null> {
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

async function workflowExists(): Promise<boolean> {
  try {
    const workflowPath = join(process.cwd(), ".github", "workflows", "repomirror.yml");
    await fs.access(workflowPath);
    return true;
  } catch {
    return false;
  }
}

export async function setupGithubPrSync(options?: SetupGithubPrSyncOptions): Promise<void> {
  console.log(
    chalk.cyan("I'll help you set up a github actions workflow that will run the sync-one command on every pr merge\n")
  );

  // Check if repomirror.yaml exists
  const existingConfig = await loadExistingConfig();
  if (!existingConfig) {
    console.error(chalk.red("Error: repomirror.yaml not found"));
    console.log(chalk.yellow("Please run 'npx repomirror init' first"));
    process.exit(1);
  }

  // Load existing GitHub PR sync defaults from config
  const existingGithubPrSyncConfig = existingConfig["github-pr-sync"] || {};
  
  // Merge CLI options, existing config, and defaults
  const defaults = {
    targetRepo: options?.targetRepo || existingGithubPrSyncConfig.targetRepo || "",
    timesToLoop: options?.timesToLoop || existingGithubPrSyncConfig.timesToLoop || 3,
  };

  // Check if workflow already exists
  const exists = await workflowExists();
  if (exists && !options?.overwrite) {
    const { shouldOverwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldOverwrite",
        message: "GitHub Actions workflow already exists. Do you want to overwrite it?",
        default: false,
      },
    ]);

    if (!shouldOverwrite) {
      console.log(chalk.yellow("Exiting without making changes."));
      process.exit(0);
    }
  }

  // Prompt for configuration
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "targetRepo",
      message: "Target repo, e.g. repomirrorhq/repomirror:",
      default: defaults.targetRepo,
      when: !options?.targetRepo,
      validate: (input) => {
        if (!input || !input.includes("/")) {
          return "Please provide the GitHub repository in owner/repo format";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "timesToLoop",
      message: "Times to loop (advanced, recommend 3):",
      default: defaults.timesToLoop.toString(),
      when: !options?.timesToLoop,
      validate: (input) => {
        const num = parseInt(input);
        if (isNaN(num) || num < 1 || num > 10) {
          return "Please enter a number between 1 and 10";
        }
        return true;
      },
      filter: (input) => parseInt(input),
    },
  ]);

  // Merge final configuration
  const finalConfig = {
    targetRepo: options?.targetRepo || answers.targetRepo,
    timesToLoop: options?.timesToLoop || answers.timesToLoop,
  };

  // Update and save repomirror.yaml with GitHub PR sync settings
  const updatedConfig: RepoMirrorConfig = {
    sourceRepo: existingConfig.sourceRepo || "./",
    targetRepo: existingConfig.targetRepo || "../transformed",
    transformationInstructions: existingConfig.transformationInstructions || "transform the repository",
    ...existingConfig,
    "github-pr-sync": {
      targetRepo: finalConfig.targetRepo,
      timesToLoop: finalConfig.timesToLoop,
    },
  };

  await saveConfig(updatedConfig);
  console.log(chalk.green("✅ Updated repomirror.yaml with GitHub PR sync settings"));

  // Create .github/workflows directory if it doesn't exist
  const workflowDir = join(process.cwd(), ".github", "workflows");
  await fs.mkdir(workflowDir, { recursive: true });

  // Generate workflow content
  const workflowContent = DEFAULT_WORKFLOW
    .replace(/{TARGET_REPO}/g, finalConfig.targetRepo)
    .replace(/{TIMES_TO_LOOP}/g, finalConfig.timesToLoop.toString());

  // Write workflow file
  const workflowPath = join(workflowDir, "repomirror.yml");
  const spinner = ora("Creating GitHub Actions workflow...").start();

  try {
    await fs.writeFile(workflowPath, workflowContent);
    spinner.succeed("GitHub Actions workflow created");

    console.log(chalk.green(`\n✅ Workflow created at ${workflowPath}`));
    console.log(chalk.cyan("\nNext steps:"));
    console.log(chalk.white("• push to github"));
    console.log(chalk.white("• add secrets for ANTHROPIC_API_KEY and GITHUB_TOKEN, where GITHUB_TOKEN has read/push access to the target repo"));
    
    console.log(chalk.yellow("\n⚠️  Important:"));
    console.log(chalk.yellow("Make sure to set up the required GitHub secrets:"));
    console.log(chalk.gray("  - ANTHROPIC_API_KEY: Your Anthropic API key for Claude"));
    console.log(chalk.gray("  - GITHUB_TOKEN: Already provided by GitHub Actions (ensure repo permissions)"));
    
  } catch (error) {
    spinner.fail("Failed to create workflow");
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}