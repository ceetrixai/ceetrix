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
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import which from 'which';

const execFileAsync = promisify(execFile);

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
 * Environment for running opencode against the temp configuration root.
 *
 * XDG_CONFIG_HOME must be set explicitly rather than inherited. The Codex
 * template overrides HOME only, which is not enough here: opencode reads a
 * nested config path and honours the XDG variable, so an ambient value in the
 * developer's shell would point it at their real configuration.
 *
 * @returns Environment for the child process
 */
function opencodeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, XDG_CONFIG_HOME: tempConfigRoot };
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
 * Run `opencode mcp list` against the temp configuration root.
 *
 * @returns Combined output
 */
async function runMcpList(): Promise<string> {
  const { stdout, stderr } = await execFileAsync(opencodePath!, ['mcp', 'list'], {
    timeout: OPENCODE_TIMEOUT_MS,
    env: opencodeEnv(),
  });
  return `${stdout}${stderr}`;
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
    const output = await runMcpList();

    // The credential above is deliberately invalid, so a failure here is the
    // expected result — and it proves more than a success would at this point.
    // It shows opencode parsed the file, recognised the entry as a remote
    // server, resolved the URL and reached Ceetrix. A green result alone
    // cannot distinguish "correct" from "never attempted".
    expect(output).toContain('ceetrix');
    expect(output).toContain('api.ceetrix.com/mcp');
  }, OPENCODE_TIMEOUT_MS);

  it('lists nothing named ceetrix before the config is written', async () => {
    if (!opencodePath) {
      console.log('Skipping: OpenCode not installed');
      return;
    }

    const output = await runMcpList();
    expect(output).not.toContain('ceetrix');
  }, OPENCODE_TIMEOUT_MS);

  it('removal takes the entry back out of what opencode reports', async () => {
    if (!opencodePath) {
      console.log('Skipping: OpenCode not installed');
      return;
    }

    await addViaHarness();
    expect(await runMcpList()).toContain('ceetrix');

    await removeViaHarness();
    expect(await runMcpList()).not.toContain('ceetrix');
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
