/**
 * Claude CLI integration
 *
 * Uses the `which` package for cross-platform executable detection.
 * This handles non-login shells (e.g., npx context) where PATH may not
 * include user-configured directories like /opt/homebrew/bin.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import which from 'which';
import { getMcpServerUrl } from './constants.js';

const execAsync = promisify(exec);

/** Timeout for Claude CLI commands in milliseconds */
const CLAUDE_COMMAND_TIMEOUT_MS = 10000;

/** Common installation paths for Claude CLI (fallback when not in PATH) */
const COMMON_CLAUDE_PATHS = [
  '/opt/homebrew/bin/claude', // macOS Homebrew ARM
  '/usr/local/bin/claude', // macOS Homebrew Intel / Linux
  `${process.env.HOME}/.local/bin/claude`, // pip/pipx style installs
];

/** Cached path to claude executable */
let cachedClaudePath: string | null = null;

/**
 * Find claude executable using the `which` package.
 * Falls back to common installation paths if not in PATH.
 *
 * @returns Full path to claude executable, or null if not found
 */
async function findClaudePath(): Promise<string | null> {
  // Try standard PATH lookup first
  try {
    return await which('claude');
  } catch {
    // Not in PATH, try common locations
  }

  // Fallback: check common installation paths
  for (const path of COMMON_CLAUDE_PATHS) {
    try {
      // which() can verify a specific path exists and is executable
      await which(path);
      return path;
    } catch {
      // Try next path
    }
  }

  return null;
}

/**
 * Get the cached claude path, finding it if not already cached.
 *
 * @returns Full path to claude executable, or empty string if not found
 */
async function getClaudePath(): Promise<string> {
  if (cachedClaudePath === null) {
    cachedClaudePath = (await findClaudePath()) ?? '';
  }
  return cachedClaudePath;
}

/**
 * Check if the Claude CLI is available.
 *
 * @returns true if claude command is available and responds to --version
 */
export async function checkClaudeCli(): Promise<boolean> {
  const claudePath = await getClaudePath();
  if (!claudePath) return false;

  try {
    await execAsync(`"${claudePath}" --version`, {
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
 * @throws Error if Claude CLI not found or command fails
 */
export async function addConfig(apiKey: string): Promise<void> {
  const claudePath = await getClaudePath();
  if (!claudePath) {
    throw new Error('Claude CLI not found');
  }

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

  await execAsync(`"${claudePath}" mcp add-json ceetrix '${escaped}' --scope user`, {
    timeout: CLAUDE_COMMAND_TIMEOUT_MS,
  });
}

/**
 * Check if Ceetrix is already configured in Claude Code.
 *
 * @returns true if ceetrix server is configured
 */
export async function checkExistingConfig(): Promise<boolean> {
  const claudePath = await getClaudePath();
  if (!claudePath) return false;

  try {
    const { stdout } = await execAsync(`"${claudePath}" mcp list`, {
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
 * @throws Error if Claude CLI not found or command fails
 */
export async function removeConfig(): Promise<void> {
  const claudePath = await getClaudePath();
  if (!claudePath) {
    throw new Error('Claude CLI not found');
  }

  await execAsync(`"${claudePath}" mcp remove ceetrix`, {
    timeout: CLAUDE_COMMAND_TIMEOUT_MS,
  });
}
