/**
 * Integration tests for Codex CLI config → parse → discovery pipeline (Story 397, Task 397.9)
 *
 * These tests run actual Codex CLI against config written by addConfig().
 * They verify what unit tests cannot: that Codex correctly reads and interprets
 * the TOML we generate.
 *
 * Skip gracefully if Codex CLI is not installed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import which from 'which';

const execFileAsync = promisify(execFile);

/** Test API key — never sent to a real server, only written to temp config */
const TEST_API_KEY = 'cxk_integration_test_key_abc123';

/** Test MCP server URL */
const TEST_MCP_URL = 'https://api.ceetrix.com/mcp';

/** Codex CLI command timeout in ms */
const CODEX_TIMEOUT_MS = 10_000;

/** Expected MCP server name in config */
const EXPECTED_SERVER_NAME = 'ceetrix';

/** Parsed entry from `codex mcp list --json` */
interface CodexMcpEntry {
  name: string;
  enabled: boolean;
  transport: {
    type: string;
    url: string;
    http_headers: Record<string, string> | null;
    env_http_headers: Record<string, string> | null;
    bearer_token_env_var: string | null;
  };
  auth_status: string;
}

/**
 * Detect codex binary path. Returns null if not installed.
 */
async function findCodex(): Promise<string | null> {
  try {
    return await which('codex');
  } catch {
    return null;
  }
}

describe('Codex CLI integration: config → parse → list', () => {
  let codexPath: string | null = null;
  let tempHome: string;

  beforeAll(async () => {
    codexPath = await findCodex();
  });

  beforeEach(async () => {
    // Fresh temp HOME for each test — no cross-contamination
    tempHome = await mkdtemp(join(tmpdir(), 'codex-integration-'));
  });

  afterAll(async () => {
    // Cleanup is per-test via afterEach, but guard against leaked temps
  });

  /**
   * Write Codex config using the real addConfig() function, with HOME overridden
   * so it writes to our temp directory instead of the user's real ~/.codex/.
   */
  async function writeConfigViAddConfig(): Promise<void> {
    // Override HOME so addConfig writes to temp dir
    const originalHome = process.env.HOME;
    try {
      process.env.HOME = tempHome;
      // Dynamic import to pick up the overridden HOME
      // Reset module cache to ensure fresh constants resolution
      const { addConfig, resetCache } = await import('../src/codex.js');
      resetCache();
      await addConfig(TEST_API_KEY, TEST_MCP_URL);
    } finally {
      process.env.HOME = originalHome;
    }
  }

  /**
   * Run `codex mcp list --json` with HOME pointing to temp dir.
   */
  async function runCodexMcpList(): Promise<CodexMcpEntry[]> {
    const { stdout } = await execFileAsync(codexPath!, ['mcp', 'list', '--json'], {
      timeout: CODEX_TIMEOUT_MS,
      env: { ...process.env, HOME: tempHome },
    });
    return JSON.parse(stdout) as CodexMcpEntry[];
  }

  // --- Core pipeline test: write config → codex reads it correctly ---

  it('codex mcp list shows ceetrix with http_headers containing actual key', async () => {
    if (!codexPath) {
      console.log('Skipping: Codex CLI not installed');
      return;
    }

    await writeConfigViAddConfig();
    const entries = await runCodexMcpList();

    const ceetrix = entries.find(e => e.name === EXPECTED_SERVER_NAME);
    expect(ceetrix, 'ceetrix entry must exist in codex mcp list').toBeDefined();
    expect(ceetrix!.transport.url).toBe(TEST_MCP_URL);
    expect(ceetrix!.transport.http_headers).toEqual({ 'X-API-Key': TEST_API_KEY });
    // Regression guard: env_http_headers must NOT be set
    expect(ceetrix!.transport.env_http_headers).toBeNull();
  });

  it('codex mcp list returns empty when no config exists', async () => {
    if (!codexPath) {
      console.log('Skipping: Codex CLI not installed');
      return;
    }

    // tempHome has no .codex/ directory
    const entries = await runCodexMcpList();
    expect(entries).toEqual([]);
  });

  // --- TOML format verification: what Codex actually reads ---

  it('generated TOML uses [mcp_servers.ceetrix.http_headers] section', async () => {
    await writeConfigViAddConfig();

    const configPath = join(tempHome, '.codex', 'config.toml');
    const content = await readFile(configPath, 'utf-8');

    // The TOML should contain the section header and key-value
    expect(content).toContain('[mcp_servers.ceetrix.http_headers]');
    expect(content).toContain(`X-API-Key = "${TEST_API_KEY}"`);
    expect(content).toContain(`url = "${TEST_MCP_URL}"`);

    // Must NOT contain env_http_headers
    expect(content).not.toContain('env_http_headers');
  });

  it('generated TOML preserves existing non-ceetrix servers', async () => {
    // Write a pre-existing config with another server
    const { mkdir, writeFile } = await import('fs/promises');
    const configDir = join(tempHome, '.codex');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.toml'), [
      '[mcp_servers.other_tool]',
      'url = "https://other.example.com/mcp"',
      '',
    ].join('\n'));

    await writeConfigViAddConfig();

    if (!codexPath) {
      console.log('Skipping codex verification: Codex CLI not installed');
      return;
    }

    const entries = await runCodexMcpList();

    // Both servers should be present
    const other = entries.find(e => e.name === 'other_tool');
    const ceetrix = entries.find(e => e.name === EXPECTED_SERVER_NAME);

    expect(other, 'pre-existing server must be preserved').toBeDefined();
    expect(other!.transport.url).toBe('https://other.example.com/mcp');

    expect(ceetrix, 'ceetrix entry must be added').toBeDefined();
    expect(ceetrix!.transport.http_headers).toEqual({ 'X-API-Key': TEST_API_KEY });
  });

  // --- Cleanup ---

  afterEach(async () => {
    try {
      await rm(tempHome, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });
});
