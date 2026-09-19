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
import { writeFile } from 'fs/promises';
import which from 'which';
import { getMcpServerUrl } from './constants.js';

const execAsync = promisify(exec);

/** Timeout for Claude CLI commands in milliseconds */
const CLAUDE_COMMAND_TIMEOUT_MS = 10000;

/**
 * Expected string in Claude Code version output.
 *
 * Exported because the diagnostic report needs the same values. Keeping a
 * second copy there is how this list drifted out of step once already
 * (docs/design/ceetrix-v2.md:701); these are deliberately NOT moved into
 * constants.ts, because claude.test.ts mocks that module and moving them
 * breaks twelve tests that exist to catch exactly this kind of change.
 */
export const CLAUDE_CODE_VERSION_MARKER = 'Claude Code';

/** Minimum required Claude CLI version (2.0 supports http transport) */
export const MIN_CLAUDE_VERSION = { major: 2, minor: 0 };

/** Common installation paths for Claude CLI (fallback when not in PATH) */
export const COMMON_CLAUDE_PATHS = [
  '/opt/homebrew/bin/claude', // macOS Homebrew ARM
  '/usr/local/bin/claude', // macOS Homebrew Intel / Linux
  '/usr/bin/claude', // Linux system package
  '/snap/bin/claude', // Linux Snap package
  `${process.env.HOME}/.local/bin/claude`, // pip/pipx style installs
];

/**
 * Short timeout for version check (old versions may hang).
 *
 * Exported so the detection tests assert against the value actually used,
 * rather than against a copy declared inside the test file.
 */
export const VERSION_CHECK_TIMEOUT_MS = 3000;

/** Cached path to claude executable */
let cachedClaudePath: string | null = null;

/**
 * Parse version string like "2.0.76 (Claude Code)" into major/minor numbers.
 *
 * @param versionOutput - Output from claude --version
 * @returns Object with major and minor version, or null if parsing fails
 */
function parseClaudeVersion(
  versionOutput: string
): { major: number; minor: number } | null {
  // Match patterns like "2.0.76" or "0.2.126"
  const match = versionOutput.match(/^(\d+)\.(\d+)\./);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
  };
}

/**
 * Check if version meets minimum requirements.
 *
 * @param version - Parsed version object
 * @returns true if version >= MIN_CLAUDE_VERSION
 */
function meetsMinVersion(version: { major: number; minor: number }): boolean {
  if (version.major > MIN_CLAUDE_VERSION.major) return true;
  if (version.major < MIN_CLAUDE_VERSION.major) return false;
  return version.minor >= MIN_CLAUDE_VERSION.minor;
}

/**
 * Verify a path is actually Claude Code with sufficient version.
 *
 * @param path - Path to executable
 * @returns true if responds with "Claude Code" and version >= 2.0
 */
async function isClaudeCode(path: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`"${path}" --version`, {
      timeout: VERSION_CHECK_TIMEOUT_MS,
    });

    // Must be Claude Code
    if (!stdout.includes(CLAUDE_CODE_VERSION_MARKER)) {
      return false;
    }

    // Must meet minimum version
    const version = parseClaudeVersion(stdout);
    if (!version || !meetsMinVersion(version)) {
      return false;
    }

    return true;
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
 * Uses `claude mcp add` with --transport http. Requires Claude CLI >= 2.0.
 *
 * @param apiKey - The API key to use for authentication
 * @throws Error if Claude CLI not found or command fails
 */
export async function addConfig(apiKey: string): Promise<void> {
  const claudePath = await getClaudePath();
  if (!claudePath) {
    throw new Error(
      'Claude CLI not found or version too old. Requires Claude Code >= 2.0. ' +
        'Install/update: https://docs.anthropic.com/en/docs/claude-code'
    );
  }

  const url = getMcpServerUrl();

  // Use http transport (requires Claude CLI >= 2.0)
  await execAsync(
    `"${claudePath}" mcp add --transport http -H "X-API-Key: ${apiKey}" --scope user ceetrix "${url}"`,
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

/**
 * Write Ceetrix MCP config directly to a file.
 *
 * This bypasses `claude mcp add` and writes the config JSON directly,
 * allowing tests to use a custom config file without touching ~/.claude.json.
 *
 * @param apiKey - The API key for authentication
 * @param url - The MCP server URL
 * @param filePath - Path to write the config file
 */
export async function writeConfigToFile(
  apiKey: string,
  url: string,
  filePath: string
): Promise<void> {
  const config = {
    mcpServers: {
      ceetrix: {
        type: 'http',
        url: url,
        headers: {
          'X-API-Key': apiKey,
        },
      },
    },
  };

  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Reset cached claude path (for testing).
 *
 * Mirrors the equivalent in codex.ts. The harness registry needs every entry
 * to be resettable so one module's memoised probe cannot leak into another
 * module's test.
 */
export function resetCache(): void {
  cachedClaudePath = null;
}
