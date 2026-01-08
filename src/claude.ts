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
 * Permission is requested once upfront in index.ts, not per-command.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import which from 'which';
import { getMcpServerUrl } from './constants.js';

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
 *
 * @returns Full path to claude executable, or null if not found
 */
async function findClaudePath(): Promise<string | null> {
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
 * Uses `claude mcp add` with --transport sse for compatibility with older CLI versions.
 * Older Claude CLI (< 2.x) only supports stdio and sse, not http.
 *
 * @param apiKey - The API key to use for authentication
 * @throws Error if Claude CLI not found or command fails
 */
export async function addConfig(apiKey: string): Promise<void> {
  const claudePath = await getClaudePath();
  if (!claudePath) {
    throw new Error('Claude CLI not found');
  }

  const url = getMcpServerUrl();

  // Use claude mcp add with sse transport for compatibility
  // Older CLI versions (< 2.x) don't support --transport http
  await execAsync(
    `"${claudePath}" mcp add --transport sse -H "X-API-Key: ${apiKey}" --scope user ceetrix "${url}"`,
    {
      timeout: CLAUDE_COMMAND_TIMEOUT_MS,
    }
  );
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
