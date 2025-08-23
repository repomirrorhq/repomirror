import { promises as fs } from "fs";
import { join } from "path";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";

interface GitHubActionsOptions {
  workflowName?: string;
  schedule?: string;
  autoPush?: boolean;
}

const DEFAULT_WORKFLOW = `name: RepoMirror Sync

on:
  schedule:
    # Run every 6 hours
    - cron: '{SCHEDULE}'
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
      uses: actions/checkout@v3
      with:
        path: source
    
    - name: Checkout target repository
      uses: actions/checkout@v3
      with:
        repository: {TARGET_REPO}
        token: \${{ secrets.GITHUB_TOKEN }}
        path: target
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
    
    - name: Install repomirror
      run: npm install -g repomirror
    
    - name: Setup Claude Code
      env:
        CLAUDE_API_KEY: \${{ secrets.CLAUDE_API_KEY }}
      run: |
        # Setup Claude Code with API key
        echo "Setting up Claude Code..."
        # Note: You'll need to configure Claude Code authentication
        # according to your setup. This might involve setting up
        # a service account or using API keys.
    
    - name: Run RepoMirror sync
      working-directory: source
      env:
        SKIP_CLAUDE_TEST: true # Skip interactive Claude test in CI
      run: |
        # Run the sync once
        npx repomirror sync
    
    - name: Push changes to target
      if: {AUTO_PUSH}
      working-directory: target
      run: |
        git config user.name "GitHub Actions"
        git config user.email "actions@github.com"
        
        if [ -n "$(git status --porcelain)" ]; then
          git add -A
          git commit -m "Automated sync from source repository"
          git push
        else
          echo "No changes to push"
        fi
`;

export async function githubActions(options?: GitHubActionsOptions): Promise<void> {
  console.log(chalk.cyan("Setting up GitHub Actions workflow for RepoMirror\n"));

  // Check if repomirror.yaml exists
  const configPath = join(process.cwd(), "repomirror.yaml");
  try {
    await fs.access(configPath);
  } catch {
    console.error(chalk.red("Error: repomirror.yaml not found"));
    console.log(chalk.yellow("Please run 'npx repomirror init' first"));
    process.exit(1);
  }

  // Load config to get target repo
  const yaml = await import("yaml");
  const configContent = await fs.readFile(configPath, "utf-8");
  const config = yaml.parse(configContent);

  // Prompt for workflow configuration
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "workflowName",
      message: "Workflow file name:",
      default: options?.workflowName || "repomirror-sync.yml",
      validate: (input) => {
        if (!input.endsWith(".yml") && !input.endsWith(".yaml")) {
          return "Workflow file must end with .yml or .yaml";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "schedule",
      message: "Cron schedule (or press enter for every 6 hours):",
      default: options?.schedule || "0 */6 * * *",
      when: !options?.schedule,
    },
    {
      type: "confirm",
      name: "autoPush",
      message: "Automatically push changes to target repository?",
      default: options?.autoPush !== undefined ? options.autoPush : true,
      when: options?.autoPush === undefined,
    },
    {
      type: "input",
      name: "targetRepo",
      message: "Target repository (owner/repo format for GitHub):",
      default: config.targetRepo?.replace(/^\.\.\//, "").replace(/-transformed$/, ""),
      validate: (input) => {
        if (!input || input === config.targetRepo) {
          return "Please provide the GitHub repository in owner/repo format";
        }
        return true;
      },
    },
  ]);

  const finalOptions = {
    workflowName: options?.workflowName || answers.workflowName,
    schedule: options?.schedule || answers.schedule,
    autoPush: options?.autoPush !== undefined ? options.autoPush : answers.autoPush,
    targetRepo: answers.targetRepo,
  };

  // Create .github/workflows directory if it doesn't exist
  const workflowDir = join(process.cwd(), ".github", "workflows");
  await fs.mkdir(workflowDir, { recursive: true });

  // Generate workflow content
  const workflowContent = DEFAULT_WORKFLOW
    .replace("{SCHEDULE}", finalOptions.schedule)
    .replace("{TARGET_REPO}", finalOptions.targetRepo)
    .replace("{AUTO_PUSH}", finalOptions.autoPush ? "true" : "false");

  // Write workflow file
  const workflowPath = join(workflowDir, finalOptions.workflowName);
  const spinner = ora("Creating GitHub Actions workflow...").start();
  
  try {
    await fs.writeFile(workflowPath, workflowContent);
    spinner.succeed("GitHub Actions workflow created");
    
    console.log(chalk.green(`\n✅ Workflow created at ${workflowPath}`));
    console.log(chalk.cyan("\nNext steps:"));
    console.log(chalk.white("1. Review and customize the workflow file as needed"));
    console.log(chalk.white("2. Set up the following GitHub secrets:"));
    console.log(chalk.gray("   - CLAUDE_API_KEY: Your Claude API key"));
    console.log(chalk.gray("   - GITHUB_TOKEN: Already provided by GitHub Actions"));
    console.log(chalk.white("3. Commit and push the workflow file to your repository"));
    console.log(chalk.white("4. The workflow will run on the schedule you specified"));
    
    console.log(chalk.yellow("\n⚠️  Important:"));
    console.log(chalk.yellow("Make sure to configure Claude Code authentication in the workflow"));
    console.log(chalk.yellow("This typically requires setting up API keys or service accounts"));
  } catch (error) {
    spinner.fail("Failed to create workflow");
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}