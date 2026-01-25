/**
 * Antigravity integration
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

/** Antigravity global config path */
const ANTIGRAVITY_CONFIG_DIR = join(homedir(), '.gemini', 'antigravity');
const ANTIGRAVITY_CONFIG_PATH = join(ANTIGRAVITY_CONFIG_DIR, 'mcp_config.json');

/**
 * Check if the CLI is running within an Antigravity environment.
 * 
 * @returns true if ANTIGRAVITY_AGENT is set
 */
export function isAntigravityAvailable(): boolean {
  return process.env.ANTIGRAVITY_AGENT === '1';
}

/**
 * Add Ceetrix MCP server configuration to Antigravity.
 *
 * Writes to ~/.gemini/antigravity/mcp_config.json
 *
 * @param apiKey - The API key to use for authentication
 * @param url - The MCP server URL
 */
export async function addConfig(apiKey: string, url: string): Promise<void> {
  // Ensure directory exists
  await mkdir(ANTIGRAVITY_CONFIG_DIR, { recursive: true });

  let config: any = { mcpServers: {} };

  try {
    const existingContent = await readFile(ANTIGRAVITY_CONFIG_PATH, 'utf-8');
    if (existingContent.trim()) {
      config = JSON.parse(existingContent);
    }
  } catch (err) {
    // File doesn't exist or is invalid, start with empty config
  }

  // Ensure mcpServers object exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Add or update ceetrix server
  config.mcpServers.ceetrix = {
    type: 'remote',
    url: url,
    headers: {
      'X-API-Key': apiKey,
    },
  };

  await writeFile(ANTIGRAVITY_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Check if Ceetrix is already configured in Antigravity.
 *
 * @returns true if ceetrix server is configured
 */
export async function checkExistingConfig(): Promise<boolean> {
  try {
    const existingContent = await readFile(ANTIGRAVITY_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(existingContent);
    return !!(config.mcpServers && config.mcpServers.ceetrix);
  } catch {
    return false;
  }
}

/**
 * Remove Ceetrix configuration from Antigravity.
 */
export async function removeConfig(): Promise<void> {
  try {
    const existingContent = await readFile(ANTIGRAVITY_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(existingContent);
    
    if (config.mcpServers && config.mcpServers.ceetrix) {
      delete config.mcpServers.ceetrix;
      await writeFile(ANTIGRAVITY_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    }
  } catch {
    // File doesn't exist or other error, nothing to remove
  }
}
