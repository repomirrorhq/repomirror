import * as fs from "fs-extra";
import * as path from "path";
import * as yaml from "yaml";
import chalk from "chalk";
import ora, { Ora } from "ora";
import { execa } from "execa";
import {
  generateMigrationPrompt,
  generateSourceAnalysisPrompt,
  generateTargetAnalysisPrompt,
  PromptContext,
} from "./prompts";

/**
 * Configuration interface matching the new spec format
 */
export interface RepoMirrorConfig {
  syncs: Array<{
    source: {
      path: string;
    };
    target: {
      repo: string;
    };
    instructions: string;
    agent: "claude_code" | "amp";
  }>;
}

export class SyncExecutor {
  private workingDir: string;
  private repoMirrorDir: string;
  private spinner: Ora;

  constructor(configPath: string) {
    this.workingDir = path.dirname(configPath);
    this.repoMirrorDir = path.join(this.workingDir, ".repomirror");
    this.spinner = ora();
  }

  /**
   * Main execution method that orchestrates the simplified sync process
   */
  public async execute(configPath: string): Promise<void> {
    try {
      this.spinner.start("Loading configuration");
      const config = await this.loadConfig(configPath);
      this.spinner.succeed("Configuration loaded");

      // Process each sync configuration
      for (const syncConfig of config.syncs) {
        await this.executeSingleSync(syncConfig);
      }

      this.spinner.succeed(chalk.green("All sync operations completed successfully"));
    } catch (error) {
      this.spinner.fail(chalk.red("Sync failed"));
      console.error(chalk.red("Error details:"), error);
      throw error;
    }
  }

  /**
   * Execute a single sync operation
   */
  private async executeSingleSync(syncConfig: RepoMirrorConfig['syncs'][0]): Promise<void> {
    console.log(chalk.cyan(`\n🔄 Starting sync operation`));
    console.log(chalk.blue(`Source: ${syncConfig.source.path}`));
    console.log(chalk.blue(`Target: ${syncConfig.target.repo}`));
    console.log(chalk.blue(`Agent: ${syncConfig.agent}`));

    // Step 1: Prepare .repomirror/ directory
    await this.prepareRepoMirrorDirectory();

    // Step 2: Generate and save analysis prompts
    await this.generateAnalysisPrompts(syncConfig);

    // Step 3: Execute agent with combined prompt
    await this.executeAgentWithPrompts(syncConfig);

    // Step 4: Commit changes to target repo (handled by agent)
    // Step 5: Update implementation plan (handled by agent)
    console.log(chalk.green(`✅ Sync operation completed`));
  }

  /**
   * Load and validate configuration
   */
  private async loadConfig(configPath: string): Promise<RepoMirrorConfig> {
    if (!(await fs.pathExists(configPath))) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    const configContent = await fs.readFile(configPath, "utf8");
    const config = yaml.parse(configContent) as RepoMirrorConfig;

    // Validate required configuration
    if (!config.syncs || config.syncs.length === 0) {
      throw new Error("At least one sync configuration must be provided");
    }

    for (const sync of config.syncs) {
      if (!sync.source?.path || !sync.target?.repo) {
        throw new Error("Both source.path and target.repo must be configured");
      }
      if (!sync.instructions) {
        throw new Error("Instructions must be provided for each sync");
      }
    }

    return config;
  }

  /**
   * Prepare .repomirror/ directory for intermediate files
   */
  private async prepareRepoMirrorDirectory(): Promise<void> {
    this.spinner.start("Preparing .repomirror directory");
    await fs.ensureDir(this.repoMirrorDir);
    this.spinner.succeed(".repomirror directory ready");
  }

  /**
   * Generate and save analysis prompts to .repomirror/
   */
  private async generateAnalysisPrompts(syncConfig: RepoMirrorConfig['syncs'][0]): Promise<void> {
    this.spinner.start("Generating analysis prompts");

    // Generate source analysis prompt
    const sourcePrompt = generateSourceAnalysisPrompt(path.resolve(syncConfig.source.path));
    await fs.writeFile(
      path.join(this.repoMirrorDir, "source-analysis-prompt.md"),
      sourcePrompt
    );

    // Generate target analysis prompt  
    const targetPrompt = generateTargetAnalysisPrompt(path.resolve(syncConfig.target.repo));
    await fs.writeFile(
      path.join(this.repoMirrorDir, "target-analysis-prompt.md"),
      targetPrompt
    );

    // Read implementation plan if it exists
    let implementationPlan: string | undefined;
    const planPath = path.join(this.workingDir, "@IMPLEMENTATION_PLAN.md");
    if (await fs.pathExists(planPath)) {
      implementationPlan = await fs.readFile(planPath, "utf8");
    }

    // Generate migration prompt
    const migrationPrompt = generateMigrationPrompt({
      sourceRepo: path.resolve(syncConfig.source.path),
      targetRepo: path.resolve(syncConfig.target.repo),
      instructions: syncConfig.instructions,
      implementationPlan,
    });
    
    await fs.writeFile(
      path.join(this.repoMirrorDir, "migration-prompt.md"),
      migrationPrompt
    );

    this.spinner.succeed("Analysis prompts generated");
    console.log(chalk.gray("  Prompts written to .repomirror/"));
  }

  /**
   * Execute agent with the combined prompts
   */
  private async executeAgentWithPrompts(syncConfig: RepoMirrorConfig['syncs'][0]): Promise<void> {
    this.spinner.start(`Executing ${syncConfig.agent} agent`);

    try {
      // For now, we'll use Claude Code as the agent executor
      // In a full implementation, this would call the appropriate agent
      if (syncConfig.agent === "claude_code") {
        await this.executeClaudeCodeAgent();
      } else if (syncConfig.agent === "amp") {
        await this.executeAmpAgent();
      } else {
        throw new Error(`Unknown agent: ${syncConfig.agent}`);
      }

      this.spinner.succeed("Agent execution completed");
    } catch (error) {
      this.spinner.fail("Agent execution failed");
      throw error;
    }
  }

  /**
   * Execute Claude Code agent (stub implementation)
   */
  private async executeClaudeCodeAgent(): Promise<void> {
    // This would execute the actual Claude Code agent with the prompts
    // For now, this is a placeholder that simulates the execution
    console.log(chalk.yellow("  📝 Note: Claude Code agent integration not yet implemented"));
    console.log(chalk.gray("  The agent would:"));
    console.log(chalk.gray("    1. Read prompts from .repomirror/"));
    console.log(chalk.gray("    2. Analyze source and target repositories"));
    console.log(chalk.gray("    3. Implement migration according to instructions"));
    console.log(chalk.gray("    4. Run tests and ensure they pass"));
    console.log(chalk.gray("    5. Update @IMPLEMENTATION_PLAN.md"));
    console.log(chalk.gray("    6. Commit changes to target repo"));
    
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Execute AMP agent (stub implementation)
   */
  private async executeAmpAgent(): Promise<void> {
    // This would execute the actual AMP agent with the prompts
    console.log(chalk.yellow("  📝 Note: AMP agent integration not yet implemented"));
    
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Update implementation plan after completion (called by agent)
   */
  private async updateImplementationPlan(): Promise<void> {
    // This method is a placeholder - the actual updating is done by the agent
    // as part of its execution workflow
    console.log(chalk.gray("  Implementation plan will be updated by the agent"));
  }
}
