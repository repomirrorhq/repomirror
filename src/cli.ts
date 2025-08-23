#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init";
import { syncOne } from "./commands/sync-one";
import { sync } from "./commands/sync";
import { syncForever } from "./commands/sync-forever";
import { visualize } from "./commands/visualize";

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

program.command("sync").description("Run one sync iteration").action(sync);

program
  .command("sync-one")
  .description("Run one sync iteration (alias for sync)")
  .action(syncOne);

program
  .command("sync-forever")
  .description("Run sync continuously")
  .action(syncForever);

program
  .command("visualize")
  .description("Visualize Claude output stream")
  .option("--debug", "Show debug timestamps")
  .action((options) => visualize(options));

program.parse();
