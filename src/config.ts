/**
 * Configuration management for existing Ceetrix setup
 */

import { checkExistingConfig as checkClaudeConfig, removeConfig as removeClaudeConfig } from './claude.js';

/**
 * Check if Ceetrix is already configured in Claude Code.
 *
 * @returns true if ceetrix MCP server is configured
 */
export async function checkExistingConfig(): Promise<boolean> {
  return checkClaudeConfig();
}

/**
 * Remove existing Ceetrix configuration from Claude Code.
 *
 * @throws Error if removal fails
 */
export async function removeExistingConfig(): Promise<void> {
  await removeClaudeConfig();
}
