import * as fs from "fs-extra";
import * as path from "path";
import * as yaml from "yaml";
import chalk from "chalk";
import ora, { Ora } from "ora";
import { execa } from "execa";

interface SyncConfig {
  source: {
    path: string;
  };
  target: {
    repo: string;
  };
  instructions: string;
  agent: "claude_code" | "amp";
}

interface Config {
  syncs: SyncConfig[];
}

interface TaskFile {
  name: string;
  content: string;
}

export async function syncOne(): Promise<void> {
  const spinner = ora("Starting sync iteration").start();

  try {
    const configPath = path.join(process.cwd(), "repomirror.yaml");

    if (!(await fs.pathExists(configPath))) {
      spinner.fail("Configuration file not found");
      console.log(chalk.red("repomirror.yaml not found in current directory"));
      console.log(
        chalk.blue('Run "repomirror init" to create a configuration file'),
      );
      return;
    }

    spinner.text = "Loading configuration";
    const configContent = await fs.readFile(configPath, "utf8");
    const config: Config = yaml.parse(configContent);

    // Validate required configuration
    if (!config.syncs || !Array.isArray(config.syncs) || config.syncs.length === 0) {
      spinner.fail("Invalid configuration");
      console.log(
        chalk.red("At least one sync configuration must be provided in 'syncs' array"),
      );
      return;
    }

    spinner.succeed("Configuration loaded");
    console.log(chalk.blue(`Found ${config.syncs.length} sync configuration(s)`));

    // Process each sync configuration
    for (let i = 0; i < config.syncs.length; i++) {
      const syncConfig = config.syncs[i];
      console.log(chalk.cyan(`\n📋 Processing sync ${i + 1}/${config.syncs.length}`));
      console.log(chalk.gray("─".repeat(50)));
      
      await processSyncConfig(syncConfig, i + 1, spinner);
    }

    spinner.succeed("All sync iterations completed");
    console.log(chalk.green("✓ Successfully completed all synchronizations"));
  } catch (error) {
    spinner.fail("Sync failed");
    console.error(chalk.red("Error during sync:"), error);
    process.exit(1);
  }
}

async function processSyncConfig(
  syncConfig: SyncConfig,
  index: number,
  spinner: Ora,
): Promise<void> {
  try {
    // Validate sync configuration
    if (!syncConfig.source?.path || !syncConfig.target?.repo) {
      throw new Error(`Sync ${index}: Both source.path and target.repo must be configured`);
    }

    if (!syncConfig.agent || !['claude_code', 'amp'].includes(syncConfig.agent)) {
      throw new Error(`Sync ${index}: agent must be either 'claude_code' or 'amp'`);
    }

    console.log(chalk.blue(`Source: ${syncConfig.source.path}`));
    console.log(chalk.blue(`Target: ${syncConfig.target.repo}`));
    console.log(chalk.blue(`Agent: ${syncConfig.agent}`));

    // Create .repomirror directory
    const repomirrorDir = path.join(process.cwd(), ".repomirror");
    await fs.ensureDir(repomirrorDir);

    spinner.text = "Creating task files";
    await generateTaskFiles(repomirrorDir, syncConfig, index);
    spinner.succeed("Task files generated");

    // Execute migration using specified agent
    spinner.start("Executing migration");
    await executeMigration(syncConfig, repomirrorDir, spinner);
    spinner.succeed("Migration executed");

    // Update implementation plan
    spinner.start("Updating implementation plan");
    await updateImplementationPlan(syncConfig, index);
    spinner.succeed("Implementation plan updated");

    // Commit changes to target repo if it's a git repository
    await commitChangesToTarget(syncConfig, spinner);

  } catch (error) {
    spinner.fail(`Sync ${index} failed`);
    console.error(chalk.red(`Error in sync ${index}:`), error);
    throw error;
  }
}

async function generateTaskFiles(
  repomirrorDir: string,
  syncConfig: SyncConfig,
  index: number,
): Promise<void> {
  const taskFiles: TaskFile[] = [
    {
      name: `source_analysis_${index}.md`,
      content: generateSourceAnalysisPrompt(syncConfig),
    },
    {
      name: `target_analysis_${index}.md`,
      content: generateTargetAnalysisPrompt(syncConfig),
    },
    {
      name: `migration_plan_${index}.md`,
      content: generateMigrationPlanPrompt(syncConfig),
    },
  ];

  for (const taskFile of taskFiles) {
    const filePath = path.join(repomirrorDir, taskFile.name);
    await fs.writeFile(filePath, taskFile.content, "utf8");
  }
}

function generateSourceAnalysisPrompt(syncConfig: SyncConfig): string {
  return `# Source Repository Analysis

## Task
Analyze the source repository structure and patterns to understand the codebase that will be migrated.

## Source Path
\`${syncConfig.source.path}\`

## Instructions
${syncConfig.instructions}

## Analysis Requirements
Please analyze the source repository and provide:

1. **Repository Structure**
   - Overall directory structure
   - Key components and modules
   - File organization patterns

2. **Technology Stack**
   - Programming languages used
   - Frameworks and libraries
   - Build tools and configuration files

3. **Code Patterns**
   - Architecture patterns (MVC, component-based, etc.)
   - Naming conventions
   - Code organization principles

4. **Dependencies**
   - External dependencies
   - Internal module dependencies
   - Configuration dependencies

5. **Migration Considerations**
   - Files that will need special handling
   - Potential compatibility issues
   - Areas that might require manual intervention

## Output
Provide a detailed analysis that will inform the migration strategy and help create an accurate migration plan.
`;
}

function generateTargetAnalysisPrompt(syncConfig: SyncConfig): string {
  return `# Target Repository Analysis

## Task
Analyze the target repository structure to understand how the migrated code should be integrated.

## Target Repository
\`${syncConfig.target.repo}\`

## Instructions
${syncConfig.instructions}

## Analysis Requirements
Please analyze the target repository and provide:

1. **Repository Structure**
   - Current directory structure
   - Existing components and modules
   - Integration points for new code

2. **Technology Stack Compatibility**
   - Programming languages and versions
   - Framework compatibility
   - Build system requirements

3. **Code Standards**
   - Coding conventions and style guides
   - Architecture patterns in use
   - Testing frameworks and patterns

4. **Integration Points**
   - Where migrated code should be placed
   - How to integrate with existing systems
   - Configuration changes needed

5. **Constraints and Requirements**
   - Any limitations or restrictions
   - Performance requirements
   - Security considerations

## Output
Provide a detailed analysis that will guide the integration of migrated code into the target repository.
`;
}

function generateMigrationPlanPrompt(syncConfig: SyncConfig): string {
  return `# Migration Plan

## Task
Create a detailed migration plan based on the source and target repository analyses.

## Migration Context
- **Source:** \`${syncConfig.source.path}\`
- **Target:** \`${syncConfig.target.repo}\`
- **Agent:** ${syncConfig.agent}

## Instructions
${syncConfig.instructions}

## Plan Requirements
Based on the source and target analyses, create a comprehensive migration plan that includes:

1. **Migration Strategy**
   - Overall approach and methodology
   - Phase-by-phase breakdown
   - Risk mitigation strategies

2. **File Mapping**
   - Which source files map to which target locations
   - Files that need transformation
   - Files that need manual intervention

3. **Transformations Required**
   - Code transformations needed
   - Configuration changes
   - Dependency updates

4. **Execution Steps**
   - Detailed step-by-step migration process
   - Order of operations
   - Checkpoints and validation steps

5. **Validation and Testing**
   - How to verify successful migration
   - Tests to run after migration
   - Rollback procedures if needed

6. **Post-Migration Tasks**
   - Documentation updates
   - Team communication
   - Monitoring and maintenance

## Output
Provide a detailed, actionable migration plan that can be executed by the ${syncConfig.agent} agent.
`;
}

async function executeMigration(
  syncConfig: SyncConfig,
  repomirrorDir: string,
  spinner: Ora,
): Promise<void> {
  try {
    if (syncConfig.agent === "claude_code") {
      await executeWithClaudeCode(syncConfig, repomirrorDir, spinner);
    } else if (syncConfig.agent === "amp") {
      await executeWithAmp(syncConfig, repomirrorDir, spinner);
    } else {
      throw new Error(`Unsupported agent: ${syncConfig.agent}`);
    }
  } catch (error) {
    console.error(chalk.red("Migration execution failed:"), error);
    throw error;
  }
}

async function executeWithClaudeCode(
  syncConfig: SyncConfig,
  repomirrorDir: string,
  spinner: Ora,
): Promise<void> {
  spinner.text = "Executing migration with Claude Code";
  
  // For now, we'll create a placeholder execution log
  // In a real implementation, this would invoke Claude Code with the generated task files
  const executionLog = `# Migration Execution Log

Executed at: ${new Date().toISOString()}
Agent: claude_code
Source: ${syncConfig.source.path}
Target: ${syncConfig.target.repo}

Status: Completed

Note: This is a placeholder implementation. In production, this would:
1. Load the generated task files
2. Execute Claude Code with the migration plan
3. Apply the transformations to the target repository
4. Log all changes and operations
`;
  
  const logPath = path.join(repomirrorDir, "execution_log.md");
  await fs.writeFile(logPath, executionLog, "utf8");
  
  console.log(chalk.yellow("Note: Claude Code execution is currently a placeholder implementation"));
}

async function executeWithAmp(
  syncConfig: SyncConfig,
  repomirrorDir: string,
  spinner: Ora,
): Promise<void> {
  spinner.text = "Executing migration with AMP";
  
  // For now, we'll create a placeholder execution log
  // In a real implementation, this would invoke AMP with the generated task files
  const executionLog = `# Migration Execution Log

Executed at: ${new Date().toISOString()}
Agent: amp
Source: ${syncConfig.source.path}
Target: ${syncConfig.target.repo}

Status: Completed

Note: This is a placeholder implementation. In production, this would:
1. Load the generated task files
2. Execute AMP with the migration plan
3. Apply the transformations to the target repository
4. Log all changes and operations
`;
  
  const logPath = path.join(repomirrorDir, "execution_log.md");
  await fs.writeFile(logPath, executionLog, "utf8");
  
  console.log(chalk.yellow("Note: AMP execution is currently a placeholder implementation"));
}

async function updateImplementationPlan(
  syncConfig: SyncConfig,
  index: number,
): Promise<void> {
  const planPath = path.join(process.cwd(), "@IMPLEMENTATION_PLAN.md");
  
  const updateEntry = `\n## Sync Execution ${index} - ${new Date().toISOString()}\n` +
    `- **Source:** ${syncConfig.source.path}\n` +
    `- **Target:** ${syncConfig.target.repo}\n` +
    `- **Agent:** ${syncConfig.agent}\n` +
    `- **Status:** ✅ Completed\n` +
    `- **Instructions:** ${syncConfig.instructions.split('\n')[0]}...\n\n`;

  if (await fs.pathExists(planPath)) {
    let content = await fs.readFile(planPath, "utf8");
    content += updateEntry;
    await fs.writeFile(planPath, content, "utf8");
  } else {
    const initialContent = `# Implementation Plan\n\nThis file tracks the execution of repository synchronizations.\n${updateEntry}`;
    await fs.writeFile(planPath, initialContent, "utf8");
  }
}

async function commitChangesToTarget(
  syncConfig: SyncConfig,
  spinner: Ora,
): Promise<void> {
  try {
    const targetPath = path.resolve(syncConfig.target.repo);
    
    // Check if target is a git repository
    const gitDir = path.join(targetPath, ".git");
    if (!(await fs.pathExists(gitDir))) {
      console.log(chalk.yellow("Target is not a git repository, skipping commit"));
      return;
    }

    spinner.start("Committing changes to target repository");
    
    // Check if there are any changes to commit
    const { stdout: status } = await execa("git", ["status", "--porcelain"], {
      cwd: targetPath,
    });
    
    if (status.trim().length === 0) {
      spinner.info("No changes to commit in target repository");
      return;
    }

    // Add all changes
    await execa("git", ["add", "."], { cwd: targetPath });

    // Create commit message
    const commitMessage = `Sync from ${syncConfig.source.path}\n\nMigration executed by repomirror\nAgent: ${syncConfig.agent}\nTimestamp: ${new Date().toISOString()}\n\nInstructions:\n${syncConfig.instructions}`;

    // Commit changes
    await execa("git", ["commit", "-m", commitMessage], {
      cwd: targetPath,
    });

    spinner.succeed("Changes committed to target repository");
    console.log(chalk.gray(`  Committed changes in: ${targetPath}`));
    
  } catch (error) {
    if (error instanceof Error && error.toString().includes("nothing to commit")) {
      spinner.info("No changes to commit in target repository");
    } else {
      console.error(chalk.red("Failed to commit changes to target repository:"), error);
      // Don't throw here, as the migration itself might have succeeded
    }
  }
}