/**
 * Prompt templates for repository analysis and migration
 */

export interface PromptContext {
  sourceRepo: string;
  targetRepo: string;
  instructions: string;
  implementationPlan?: string;
}

/**
 * Template for analyzing the source repository
 */
export const SOURCE_ANALYSIS_PROMPT = `
# Source Repository Analysis

You are tasked with analyzing the SOURCE repository to understand its structure, interfaces, and information flow.

**Repository Path:** {sourceRepo}

## Instructions:
- Review everything in the source repository using as many subagents as possible
- Focus on understanding:
  - The public interfaces
  - How information flows through the system
  - Architecture and design patterns
  - Key files and their purposes

## For each important file/component, provide:
- File path and line numbers
- How it's used in the system
- Dependencies and relationships
- Public interfaces it exposes

## Output Format:
Return a comprehensive analysis as markdown that includes:
1. **Repository Overview** - high-level architecture
2. **Public Interfaces** - APIs, exports, entry points
3. **Information Flow** - how data moves through the system
4. **Key Files** - important files with their purposes
5. **Dependencies** - external and internal dependencies
6. **Patterns** - design patterns and conventions used

Write the analysis to .repomirror/source-analysis.md
`;

/**
 * Template for analyzing the target repository
 */
export const TARGET_ANALYSIS_PROMPT = `
# Target Repository Analysis

You are tasked with analyzing the TARGET repository to understand its current state and structure.

**Repository Path:** {targetRepo}

## Instructions:
- Review everything in the target repository using as many subagents as possible
- Focus on understanding:
  - Current architecture and structure
  - Existing patterns and conventions
  - Build system and configuration
  - Testing setup

## For each important file/component, provide:
- File path and line numbers
- Current implementation details
- Build/test configuration
- Existing patterns to follow

## Output Format:
Return a comprehensive analysis as markdown that includes:
1. **Repository Overview** - current state and structure
2. **Architecture** - how the project is organized
3. **Build System** - how to build and test
4. **Patterns** - existing conventions to follow
5. **Configuration** - important config files
6. **Entry Points** - main files and scripts

Write the analysis to .repomirror/target-analysis.md
`;

/**
 * Template for the main migration implementation
 */
export const MIGRATION_PROMPT = `
# Repository Migration Implementation

You are tasked with implementing a migration from the SOURCE repository to the TARGET repository.

**Source Repository:** {sourceRepo}
**Target Repository:** {targetRepo}

## Migration Instructions:
{instructions}

## Available Context:
- Source Analysis: .repomirror/source-analysis.md
- Target Analysis: .repomirror/target-analysis.md
- Implementation Plan: {implementationPlan}

## Rules:
- NEVER CHANGE THE SOURCE REPO, ONLY THE TARGET REPO
- Pick the highest priority item from @IMPLEMENTATION_PLAN.md and implement it
- Follow the migration instructions precisely
- Ensure tests and checks pass in the target repo
- Update @IMPLEMENTATION_PLAN.md with your progress
- Commit changes to the target repo with descriptive messages

## Workflow:
1. Review the source and target analyses
2. Identify the highest priority item from the implementation plan
3. Implement the migration according to the instructions
4. Run tests and ensure they pass
5. Update the implementation plan
6. Commit the changes

## Output:
- All work should be done in the target repository
- Write progress notes to .repomirror/migration-log.md
- Update @IMPLEMENTATION_PLAN.md with completed items
- Commit with a descriptive message about what was implemented
`;

/**
 * Generate the complete prompt for the agent
 */
export function generateMigrationPrompt(context: PromptContext): string {
  let prompt = MIGRATION_PROMPT
    .replace('{sourceRepo}', context.sourceRepo)
    .replace('{targetRepo}', context.targetRepo)  
    .replace('{instructions}', context.instructions);

  if (context.implementationPlan) {
    prompt = prompt.replace('{implementationPlan}', context.implementationPlan);
  } else {
    prompt = prompt.replace('{implementationPlan}', '@IMPLEMENTATION_PLAN.md');
  }

  return prompt;
}

/**
 * Generate source analysis prompt
 */
export function generateSourceAnalysisPrompt(sourceRepo: string): string {
  return SOURCE_ANALYSIS_PROMPT.replace('{sourceRepo}', sourceRepo);
}

/**
 * Generate target analysis prompt  
 */
export function generateTargetAnalysisPrompt(targetRepo: string): string {
  return TARGET_ANALYSIS_PROMPT.replace('{targetRepo}', targetRepo);
}