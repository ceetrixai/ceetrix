/**
 * OpenCode integration: write config → opencode parses it → reports the server.
 *
 * Follows the pattern of codex-integration.test.ts: a temp configuration root,
 * a lookup probe in beforeAll, a printed skip when the binary is absent so the
 * suite stays green on a machine without it, and cleanup per test.
 *
 * Documentation is not accepted as evidence in this file. That is the point of
 * it: two of the four harnesses added in story 547 had published docs that
 * described commands the shipped binaries do not have.
 *
 * OpenCode is one of only two of those harnesses with a real non-interactive
 * check, so this suite asserts more than the file contents.
 *
 * OpenCode 2 answers `opencode mcp list` from a shared background service
 * holding the developer's own configuration, which the temp root never
 * reaches. Each check therefore asks a private server started on the temp
 * root (see opencode-server.ts), and the temp configuration carries a control
 * server whose appearance shows the file has been loaded.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import which from 'which';
import {
  CONTROL_SERVER_ENTRY,
  CONTROL_SERVER_NAME,
  startOpencodeServer,
  waitForMcpServer,
  type McpServerStatus,
} from './opencode-server.js';

const TEST_API_KEY = 'test_api_key_not_real';
const TEST_MCP_URL = 'https://api.ceetrix.com/mcp';

/** Generous: the command starts a runtime and may attempt a connection. */
const OPENCODE_TIMEOUT_MS = 120000;

let opencodePath: string | null = null;
let tempConfigRoot: string;

/**
 * Find the opencode binary, or null when it is not installed.
 *
 * @returns Path to the binary, or null
 */
async function findOpencode(): Promise<string | null> {
  try {
    return await which('opencode');
  } catch {
    return null;
  }
}

/**
 * Write the config through the real harness module.
 */
async function addViaHarness(): Promise<void> {
  const previous = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = tempConfigRoot;
    const { harness } = await import('../src/opencode.js');
    await harness.add({ apiKey: TEST_API_KEY, url: TEST_MCP_URL });
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
}

/**
 * Remove the config through the real harness module.
 */
async function removeViaHarness(): Promise<void> {
  const previous = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = tempConfigRoot;
    const { harness } = await import('../src/opencode.js');
    await harness.remove();
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
}

/**
 * The MCP servers opencode loads from the temp configuration root, read from a
 * private server once it has loaded the file (the control server is listed).
 *
 * @returns Every server opencode reports, with its connection status
 */
async function listedServers(): Promise<McpServerStatus[]> {
  const server = await startOpencodeServer({
    binary: opencodePath!,
    configRoot: tempConfigRoot,
    cwd: tempConfigRoot,
  });
  try {
    return await waitForMcpServer(opencodePath!, server, tempConfigRoot, CONTROL_SERVER_NAME);
  } finally {
    await server.stop();
  }
}

/**
 * Names of the servers opencode loads.
 *
 * @returns Server names
 */
async function listedNames(): Promise<string[]> {
  return (await listedServers()).map((s) => s.name);
}

/**
 * Path to the config file inside the temp root.
 *
 * @returns Absolute path
 */
function configPath(): string {
  return join(tempConfigRoot, 'opencode', 'opencode.json');
}

describe('OpenCode integration: config → parse → list', () => {
  beforeAll(async () => {
    opencodePath = await findOpencode();
  });

  beforeEach(async () => {
    tempConfigRoot = await mkdtemp(join(tmpdir(), 'opencode-integration-'));
    await mkdir(join(tempConfigRoot, 'opencode'), { recursive: true });
    await writeFile(
      configPath(),
      `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { [CONTROL_SERVER_NAME]: CONTROL_SERVER_ENTRY } }, null, 2)}\n`,
      'utf-8'
    );
  });

  afterEach(async () => {
    await rm(tempConfigRoot, { recursive: true, force: true });
  });

  it('opencode recognises the entry Ceetrix wrote and attempts the connection', async () => {
    if (!opencodePath) {
      console.log('Skipping: OpenCode not installed');
      return;
    }

    await addViaHarness();
    const ceetrix = (await listedServers()).find((s) => s.name === 'ceetrix');

    // The credential above is deliberately invalid, so a failure here is the
    // expected result — and it proves more than a success would at this point.
    // It shows opencode parsed the file, recognised the entry as a remote
    // server, resolved the URL and reached Ceetrix, whose refusal names the
    // header it rejected. A green result alone cannot distinguish "correct"
    // from "never attempted".
    expect(ceetrix, 'opencode did not load the entry Ceetrix wrote').toBeDefined();
    expect(ceetrix!.status.status).toBe('failed');
    expect(ceetrix!.status.error).toContain('X-API-Key');
  }, OPENCODE_TIMEOUT_MS);

  it('lists nothing named ceetrix before the config is written', async () => {
    if (!opencodePath) {
      console.log('Skipping: OpenCode not installed');
      return;
    }

    expect(await listedNames()).not.toContain('ceetrix');
  }, OPENCODE_TIMEOUT_MS);

  it('removal takes the entry back out of what opencode reports', async () => {
    if (!opencodePath) {
      console.log('Skipping: OpenCode not installed');
      return;
    }

    await addViaHarness();
    expect(await listedNames()).toContain('ceetrix');

    await removeViaHarness();
    expect(await listedNames()).not.toContain('ceetrix');
  }, OPENCODE_TIMEOUT_MS);

  it('leaves a realistic config byte-identical after add then remove', async () => {
    if (!opencodePath) {
      console.log('Skipping: OpenCode not installed');
      return;
    }

    // Shaped like a real file: other providers' credentials, model choices,
    // and an unrelated MCP server, all of which must survive untouched.
    const original = `${JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        model: 'anthropic/claude-opus-5',
        provider: { openai: { options: { apiKey: 'sk-must-survive' } } },
        mcp: { pencil: { type: 'local', command: ['pencil-server'], enabled: true } },
      },
      null,
      2
    )}\n`;
    await writeFile(configPath(), original, 'utf-8');

    await addViaHarness();
    await removeViaHarness();

    expect(await readFile(configPath(), 'utf-8')).toBe(original);
  }, OPENCODE_TIMEOUT_MS);
});
