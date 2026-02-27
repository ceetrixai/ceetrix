/**
 * OpenAI Codex CLI integration (Story 397)
 *
 * Codex uses TOML config at ~/.codex/config.toml.
 * API keys are referenced via environment variables (env_http_headers),
 * never stored in plaintext.
 *
 * Direct file write because `codex mcp add` does not support custom headers.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import which from 'which';
import { parse, stringify } from 'smol-toml';
import {
  CODEX_CONFIG_DIR,
  CODEX_CONFIG_FILE,
  CODEX_MCP_SERVER_NAME,
  CODEX_API_KEY_ENV_VAR,
  CODEX_VERSION_MARKER,
  CODEX_VERSION_CHECK_TIMEOUT_MS,
  COMMON_CODEX_PATHS,
} from './constants.js';

const execAsync = promisify(exec);

/** Parsed Codex TOML config structure */
interface CodexConfig {
  mcp_servers?: Record<string, {
    url?: string;
    env_http_headers?: Record<string, string>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Full path to Codex config directory */
function getConfigDir(): string {
  return join(homedir(), CODEX_CONFIG_DIR);
}

/** Full path to Codex config file */
function getConfigPath(): string {
  return join(getConfigDir(), CODEX_CONFIG_FILE);
}

// --- Detection ---

/** Cached path to codex executable */
let cachedCodexPath: string | null = null;

/**
 * Verify a path is actually OpenAI Codex CLI.
 *
 * @param path - Path to executable
 * @returns true if responds with version output containing the Codex marker
 */
async function isCodexCli(path: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`"${path}" --version`, {
      timeout: CODEX_VERSION_CHECK_TIMEOUT_MS,
    });
    return stdout.toLowerCase().includes(CODEX_VERSION_MARKER);
  } catch {
    return false;
  }
}

/**
 * Find codex executable by checking candidates in order.
 * Verifies each candidate is actually Codex CLI.
 *
 * @returns Full path to codex executable, or null if not found
 */
async function findCodexPath(): Promise<string | null> {
  const candidates: string[] = [];

  try {
    candidates.push(await which('codex'));
  } catch {
    // Not in PATH
  }

  candidates.push(...COMMON_CODEX_PATHS);

  for (const path of candidates) {
    if (await isCodexCli(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Check if the Codex CLI is available.
 *
 * @returns true if codex command is available and responds to --version
 */
export async function isCodexAvailable(): Promise<boolean> {
  if (cachedCodexPath === null) {
    cachedCodexPath = (await findCodexPath()) ?? '';
  }
  return cachedCodexPath !== '';
}

// --- Config management ---

/**
 * Add Ceetrix MCP server configuration to Codex.
 *
 * Reads existing config.toml, merges ceetrix entry, writes back.
 * Uses env_http_headers so the API key is read from an environment
 * variable at runtime, never stored in plaintext.
 *
 * @param _apiKey - Not written to TOML. The env var name is written instead.
 * @param url - The MCP server URL
 */
export async function addConfig(_apiKey: string, url: string): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  await mkdir(configDir, { recursive: true });

  let config: CodexConfig = {};

  try {
    const existingContent = await readFile(configPath, 'utf-8');
    if (existingContent.trim()) {
      config = parse(existingContent) as CodexConfig;
    }
  } catch {
    // File doesn't exist or is invalid, start fresh
  }

  if (!config.mcp_servers) {
    config.mcp_servers = {};
  }

  config.mcp_servers[CODEX_MCP_SERVER_NAME] = {
    url,
    env_http_headers: { 'X-API-Key': CODEX_API_KEY_ENV_VAR },
  };

  await writeFile(configPath, stringify(config), 'utf-8');
}

/**
 * Check if Ceetrix is already configured in Codex.
 *
 * @returns true if ceetrix MCP server entry exists in config.toml
 */
export async function checkExistingConfig(): Promise<boolean> {
  try {
    const content = await readFile(getConfigPath(), 'utf-8');
    const config = parse(content) as CodexConfig;
    return !!(config.mcp_servers && config.mcp_servers[CODEX_MCP_SERVER_NAME]);
  } catch {
    return false;
  }
}

/**
 * Remove Ceetrix configuration from Codex.
 * Preserves all other config entries.
 */
export async function removeConfig(): Promise<void> {
  try {
    const content = await readFile(getConfigPath(), 'utf-8');
    const config = parse(content) as CodexConfig;

    if (config.mcp_servers && config.mcp_servers[CODEX_MCP_SERVER_NAME]) {
      delete config.mcp_servers[CODEX_MCP_SERVER_NAME];
      await writeFile(getConfigPath(), stringify(config), 'utf-8');
    }
  } catch {
    // File doesn't exist or other error, nothing to remove
  }
}

/**
 * Reset cached codex path (for testing).
 */
export function resetCache(): void {
  cachedCodexPath = null;
}
