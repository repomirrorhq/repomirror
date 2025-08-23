#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init";
import { syncOne } from "./commands/sync-one";
import { sync } from "./commands/sync";
import { syncForever } from "./commands/sync-forever";
import { visualize } from "./commands/visualize";
import { remote } from "./commands/remote";
import { push } from "./commands/push";
import { pull } from "./commands/pull";

const program = new Command();

program
  .name("repomirror")
  .description("Sync and transform repositories using AI agents")
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Configuration:
  repomirror uses a repomirror.yaml file to store configuration.
  On first run, settings are saved to this file.
  On subsequent runs, the file is used for defaults.
  
  Command-line flags override both yaml defaults and interactive prompts.

Examples:
  $ npx repomirror init
      Interactive mode with prompts
  
  $ npx repomirror init --source ./ --target ../myrepo-ts --instructions "convert to typescript"
      Skip prompts and use provided values
  
  $ npx repomirror help
      Show this help message`,
  );

program
  .command("init")
  .description("Initialize repomirror in current directory")
  .option("-s, --source <path>", "Source repository path")
  .option("-t, --target <path>", "Target repository path")
  .option("-i, --instructions <text>", "Transformation instructions")
  .action((options) => {
    init({
      sourceRepo: options.source,
      targetRepo: options.target,
      transformationInstructions: options.instructions,
    });
  });

program
  .command("sync")
  .description("Run one sync iteration")
  .option("--auto-push", "Automatically push to all remotes after successful sync")
  .action((options) => sync({ autoPush: options.autoPush }));

program
  .command("sync-one")
  .description("Run one sync iteration (alias for sync)")
  .option("--auto-push", "Automatically push to all remotes after successful sync")
  .action((options) => syncOne({ autoPush: options.autoPush }));

program
  .command("sync-forever")
  .description("Run sync continuously")
  .option("--auto-push", "Automatically push to all remotes after each sync iteration")
  .action((options) => syncForever({ autoPush: options.autoPush }));

program
  .command("visualize")
  .description("Visualize Claude output stream")
  .option("--debug", "Show debug timestamps")
  .action((options) => visualize(options));

program
  .command("remote <action> [args...]")
  .description("Manage remote repositories")
  .addHelpText(
    "after",
    `
Actions:
  add <name> <url> [branch]    Add a remote repository (default branch: main)
  list                         List configured remotes
  remove <name>                Remove a remote repository

Examples:
  $ npx repomirror remote add origin https://github.com/user/repo.git
  $ npx repomirror remote add staging https://github.com/user/staging.git develop
  $ npx repomirror remote list
  $ npx repomirror remote remove origin`,
  )
  .action((action, args) => remote(action, ...args));

program
  .command("push")
  .description("Push transformed changes to remote repositories")
  .option("-r, --remote <name>", "Remote repository name")
  .option("-b, --branch <name>", "Branch name to push to")
  .option("--all", "Push to all configured remotes")
  .option("--dry-run", "Show what would be pushed without actually pushing")
  .addHelpText(
    "after",
    `
Examples:
  $ npx repomirror push
      Push to default remote (origin/main)
  
  $ npx repomirror push --remote staging
      Push to specific remote using its configured branch
  
  $ npx repomirror push --remote origin --branch feature-branch
      Push to specific remote and branch
  
  $ npx repomirror push --all
      Push to all configured remotes
  
  $ npx repomirror push --dry-run
      Show what would be pushed without pushing`,
  )
  .action((options) => push(options));

program
  .command("pull")
  .description("Pull source changes and trigger re-sync")
  .option("--source-only", "Pull source without re-sync")
  .option("--sync-after", "Pull and run continuous sync after")
  .option("--check", "Check for source changes without pulling")
  .addHelpText(
    "after",
    `
Examples:
  $ npx repomirror pull
      Pull source changes and re-sync (if auto_sync is enabled)
  
  $ npx repomirror pull --source-only
      Pull source changes without triggering sync
  
  $ npx repomirror pull --sync-after
      Pull source changes and run continuous sync
  
  $ npx repomirror pull --check
      Check for available changes without pulling`,
  )
  .action((options) => pull(options));

program.parse();
