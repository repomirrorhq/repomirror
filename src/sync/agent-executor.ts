import { execa, ExecaReturnValue } from "execa";
import * as path from "path";
import chalk from "chalk";

/**
 * Interface for AI agents that can execute tasks
 */
export interface AIAgent {
  name: 'claude_code' | 'amp';
  execute(prompt: string, workingDir: string): Promise<string>;
}

/**
 * Claude Code agent implementation
 * Executes claude code commands and captures output
 */
export class ClaudeCodeAgent implements AIAgent {
  public readonly name = 'claude_code' as const;

  /**
   * Execute a prompt using Claude Code CLI
   */
  async execute(prompt: string, workingDir: string): Promise<string> {
    try {
      // Validate working directory
      if (!path.isAbsolute(workingDir)) {
        throw new Error(`Working directory must be absolute path: ${workingDir}`);
      }

      // Execute claude code command
      const result: ExecaReturnValue = await execa(
        'claude',
        ['code', '--prompt', prompt],
        {
          cwd: workingDir,
          timeout: 300000, // 5 minute timeout
          encoding: 'utf8',
          reject: false, // Don't throw on non-zero exit codes
        }
      );

      // Handle command execution results
      if (result.exitCode !== 0) {
        const errorMessage = result.stderr || result.stdout || 'Unknown error';
        throw new Error(`Claude Code execution failed (exit code ${result.exitCode}): ${errorMessage}`);
      }

      // Return the stdout output
      return result.stdout || '';

    } catch (error) {
      if (error instanceof Error) {
        // Re-throw our custom errors
        if (error.message.includes('Claude Code execution failed') || 
            error.message.includes('Working directory must be absolute')) {
          throw error;
        }
        
        // Handle other execution errors
        if (error.message.includes('ENOENT')) {
          throw new Error(
            'Claude Code CLI not found. Please ensure claude is installed and available in PATH.'
          );
        }
        
        if (error.message.includes('timeout')) {
          throw new Error('Claude Code execution timed out after 5 minutes');
        }
        
        // Generic error handling
        throw new Error(`Failed to execute Claude Code: ${error.message}`);
      }
      
      throw new Error(`Unexpected error during Claude Code execution: ${String(error)}`);
    }
  }
}

/**
 * AMP agent implementation (stub for future implementation)
 */
export class AMPAgent implements AIAgent {
  public readonly name = 'amp' as const;

  /**
   * Execute a prompt using AMP (stub implementation)
   */
  async execute(prompt: string, workingDir: string): Promise<string> {
    try {
      // Validate working directory
      if (!path.isAbsolute(workingDir)) {
        throw new Error(`Working directory must be absolute path: ${workingDir}`);
      }

      // TODO: Implement actual AMP execution logic
      console.log(chalk.yellow(`AMP agent execution (stub): ${prompt.substring(0, 100)}...`));
      console.log(chalk.gray(`Working directory: ${workingDir}`));
      
      // Simulate some processing time
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return `AMP agent response stub for prompt: "${prompt.substring(0, 50)}..."`;
      
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to execute AMP agent: ${error.message}`);
      }
      
      throw new Error(`Unexpected error during AMP execution: ${String(error)}`);
    }
  }
}

/**
 * Registry of available agents
 */
const AGENTS: Record<string, AIAgent> = {
  claude_code: new ClaudeCodeAgent(),
  amp: new AMPAgent(),
};

/**
 * Execute a prompt with the specified AI agent
 * 
 * @param agentName - Name of the agent to use ('claude_code' or 'amp')
 * @param prompt - The prompt to execute
 * @param workingDir - Absolute path to the working directory
 * @returns Promise resolving to the agent's response
 * 
 * @throws Error if agent is not found or execution fails
 */
export async function executeWithAgent(
  agentName: string,
  prompt: string,
  workingDir: string
): Promise<string> {
  // Validate inputs
  if (!agentName) {
    throw new Error('Agent name is required');
  }
  
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  
  if (!workingDir) {
    throw new Error('Working directory is required');
  }

  // Get the agent
  const agent = AGENTS[agentName];
  if (!agent) {
    const availableAgents = Object.keys(AGENTS).join(', ');
    throw new Error(
      `Unknown agent: ${agentName}. Available agents: ${availableAgents}`
    );
  }

  try {
    // Execute with the agent
    const result = await agent.execute(prompt, workingDir);
    
    // Log execution info
    console.log(chalk.gray(`✓ Agent ${agentName} completed execution`));
    console.log(chalk.gray(`  Working dir: ${workingDir}`));
    console.log(chalk.gray(`  Response length: ${result.length} characters`));
    
    return result;
    
  } catch (error) {
    console.error(chalk.red(`✗ Agent ${agentName} execution failed`));
    
    if (error instanceof Error) {
      console.error(chalk.red(`  Error: ${error.message}`));
      throw error;
    }
    
    const errorMsg = `Agent execution failed: ${String(error)}`;
    console.error(chalk.red(`  Error: ${errorMsg}`));
    throw new Error(errorMsg);
  }
}

/**
 * Get list of available agent names
 */
export function getAvailableAgents(): string[] {
  return Object.keys(AGENTS);
}

/**
 * Check if an agent is available
 */
export function isAgentAvailable(agentName: string): boolean {
  return agentName in AGENTS;
}