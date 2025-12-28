/**
 * Claude CLI integration
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getMcpServerUrl } from './constants.js';

const execAsync = promisify(exec);

/** Timeout for Claude CLI commands in milliseconds */
const CLAUDE_COMMAND_TIMEOUT_MS = 10000;

/**
 * Check if the Claude CLI is available in PATH.
 *
 * @returns true if claude command is available
 */
export async function checkClaudeCli(): Promise<boolean> {
  try {
    await execAsync('claude --version', {
      timeout: CLAUDE_COMMAND_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Add Ceetrix MCP server configuration to Claude Code.
 *
 * @param apiKey - The API key to use for authentication
 * @throws Error if the command fails
 */
export async function addConfig(apiKey: string): Promise<void> {
  const config = {
    type: 'http',
    url: getMcpServerUrl(),
    headers: {
      'X-API-Key': apiKey,
    },
  };

  const configJson = JSON.stringify(config);

  // Escape single quotes for shell
  const escaped = configJson.replace(/'/g, "'\\''");

  await execAsync(`claude mcp add-json ceetrix '${escaped}' --scope user`, {
    timeout: CLAUDE_COMMAND_TIMEOUT_MS,
  });
}

/**
 * Check if Ceetrix is already configured in Claude Code.
 *
 * @returns true if ceetrix server is configured
 */
export async function checkExistingConfig(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('claude mcp list', {
      timeout: CLAUDE_COMMAND_TIMEOUT_MS,
    });
    return stdout.includes('ceetrix:');
  } catch {
    return false;
  }
}

/**
 * Remove Ceetrix configuration from Claude Code.
 *
 * @throws Error if the command fails
 */
export async function removeConfig(): Promise<void> {
  await execAsync('claude mcp remove ceetrix', {
    timeout: CLAUDE_COMMAND_TIMEOUT_MS,
  });
}
