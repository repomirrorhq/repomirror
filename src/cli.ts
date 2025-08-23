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
  .version("0.1.0");

program
  .command("init")
  .description("Initialize repomirror in current directory")
  .action(init);

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
