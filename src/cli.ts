#!/usr/bin/env node

import { Command } from "commander";
import { init } from "./commands/init";
import { syncOne } from "./commands/sync-one";

const program = new Command();

program
  .name("repomirror")
  .description("Sync and transform repositories using AI agents")
  .version("0.1.0");

program
  .command("init")
  .description("Generate a repomirror.yaml configuration file")
  .action(init);

program
  .command("sync-one")
  .description("Run one sync iteration")
  .action(syncOne);

program.parse();
