/**
 * Claude CLI integration
 *
 * Uses the `which` package for cross-platform executable detection.
 * This handles non-login shells (e.g., npx context) where PATH may not
 * include user-configured directories like /opt/homebrew/bin.
 *
 * Verifies found binaries are actually Claude Code (not stale npm installs)
 * by checking --version output contains "Claude Code".
 *
 * All command execution requires explicit user permission.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import which from 'which';
import { getMcpServerUrl } from './constants.js';
import { requestPermission } from './permissions.js';

const execAsync = promisify(exec);

/** Timeout for Claude CLI commands in milliseconds */
const CLAUDE_COMMAND_TIMEOUT_MS = 10000;

/** Short timeout for version check (old versions may hang) */
const VERSION_CHECK_TIMEOUT_MS = 3000;

/** Expected string in Claude Code version output */
const CLAUDE_CODE_VERSION_MARKER = 'Claude Code';

/** Common installation paths for Claude CLI (fallback when not in PATH) */
const COMMON_CLAUDE_PATHS = [
  '/opt/homebrew/bin/claude', // macOS Homebrew ARM
  '/usr/local/bin/claude', // macOS Homebrew Intel / Linux
  `${process.env.HOME}/.local/bin/claude`, // pip/pipx style installs
];

/** Cached path to claude executable */
let cachedClaudePath: string | null = null;

/**
 * Verify a path is actually Claude Code by checking version output.
 * Permission must already be granted before calling this.
 *
 * @param path - Path to executable
 * @returns true if responds with "Claude Code" in version output
 */
async function isClaudeCode(path: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`"${path}" --version`, {
      timeout: VERSION_CHECK_TIMEOUT_MS,
    });
    return stdout.includes(CLAUDE_CODE_VERSION_MARKER);
  } catch {
    // Timeout, error, or doesn't respond correctly
    return false;
  }
}

/**
 * Find claude executable by checking candidates in order.
 * Verifies each candidate is actually Claude Code (not a stale npm install).
 * Requests permission before any execution.
 *
 * @returns Full path to claude executable, or null if not found or permission denied
 */
async function findClaudePath(): Promise<string | null> {
  // Request permission to search for and verify Claude CLI
  const allowed = await requestPermission(
    'which claude; claude --version',
    'Find and verify Claude Code installation'
  );

  if (!allowed) {
    console.log('Permission denied. Cannot proceed without locating Claude CLI.\n');
    return null;
  }

  const candidates: string[] = [];

  // Try which first
  try {
    candidates.push(await which('claude'));
  } catch {
    // Not in PATH
  }

  // Add common fallback paths
  candidates.push(...COMMON_CLAUDE_PATHS);

  // Find first candidate that is actually Claude Code
  for (const path of candidates) {
    if (await isClaudeCode(path)) {
      return path;
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
  return claudePath !== '';
}

/**
 * Add Ceetrix MCP server configuration to Claude Code.
 *
 * @param apiKey - The API key to use for authentication
 * @throws Error if Claude CLI not found, permission denied, or command fails
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
  const escaped = configJson.replace(/'/g, "'\\''");
  const command = `claude mcp add-json ceetrix '...' --scope user`;

  const allowed = await requestPermission(
    command,
    'Add Ceetrix server to Claude Code config'
  );

  if (!allowed) {
    throw new Error('Permission denied to add configuration');
  }

  await execAsync(`"${claudePath}" mcp add-json ceetrix '${escaped}' --scope user`, {
    timeout: CLAUDE_COMMAND_TIMEOUT_MS,
  });
}

/**
 * Check if Ceetrix is already configured in Claude Code.
 *
 * @returns true if ceetrix server is configured, false if not or permission denied
 */
export async function checkExistingConfig(): Promise<boolean> {
  const claudePath = await getClaudePath();
  if (!claudePath) return false;

  const allowed = await requestPermission(
    'claude mcp list',
    'Check if Ceetrix is already configured'
  );

  if (!allowed) {
    return false;
  }

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
 * @throws Error if Claude CLI not found, permission denied, or command fails
 */
export async function removeConfig(): Promise<void> {
  const claudePath = await getClaudePath();
  if (!claudePath) {
    throw new Error('Claude CLI not found');
  }

  const allowed = await requestPermission(
    'claude mcp remove ceetrix',
    'Remove Ceetrix from Claude Code config'
  );

  if (!allowed) {
    throw new Error('Permission denied to remove configuration');
  }

  await execAsync(`"${claudePath}" mcp remove ceetrix`, {
    timeout: CLAUDE_COMMAND_TIMEOUT_MS,
  });
}
