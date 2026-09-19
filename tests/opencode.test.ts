/**
 * Unit tests for the OpenCode harness module.
 *
 * Covers TC-31 to TC-33 from the story 547 test strategy.
 *
 * The fixture is shaped like a real opencode.json rather than a minimal stub:
 * six top-level keys, the person's provider credentials, their model choices,
 * and an unrelated MCP server. A one-key stub would pass a merge that destroys
 * a file with twenty, which is exactly the failure these tests exist to catch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { harness, getConfigPath, getJsoncConfigPath } from '../src/opencode.js';
import { HarnessSkipped } from '../src/harness.js';

const TEST_KEY = 'test_api_key';
const TEST_URL = 'https://api.ceetrix.com/mcp';

/** Permissions a real opencode.json carries: owner-only, because it holds keys. */
const OWNER_ONLY_MODE = 0o600;

let tempConfigRoot: string;
let previousXdg: string | undefined;

/**
 * A config shaped like the one on a real machine.
 *
 * @returns The fixture object
 */
function realisticConfig(): Record<string, unknown> {
  return {
    $schema: 'https://opencode.ai/config.json',
    agent: { build: { model: 'anthropic/claude-opus-5' } },
    compaction: { enabled: true, threshold: 0.8 },
    mcp: {
      pencil: {
        type: 'local',
        command: ['/Users/someone/.pencil/mcp/out/mcp-server', '--app', 'vscode'],
        enabled: true,
      },
    },
    model: 'anthropic/claude-opus-5',
    provider: {
      openai: { options: { apiKey: 'sk-do-not-lose-this' } },
      anthropic: { options: { apiKey: 'sk-ant-do-not-lose-this' } },
    },
  };
}

beforeEach(async () => {
  tempConfigRoot = await mkdtemp(join(tmpdir(), 'ceetrix-opencode-'));
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tempConfigRoot;
  await mkdir(join(tempConfigRoot, 'opencode'), { recursive: true });
});

afterEach(async () => {
  await rm(tempConfigRoot, { recursive: true, force: true });
  if (previousXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = previousXdg;
  }
});

/**
 * Read the config file back.
 *
 * @returns The parsed config
 */
async function readConfig(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(getConfigPath(), 'utf-8'));
}

/**
 * Seed the config file with the realistic fixture at owner-only permissions.
 *
 * @returns The exact bytes written
 */
async function seedRealisticConfig(): Promise<string> {
  const body = `${JSON.stringify(realisticConfig(), null, 2)}\n`;
  await writeFile(getConfigPath(), body, 'utf-8');
  await chmod(getConfigPath(), OWNER_ONLY_MODE);
  return body;
}

describe('opencode config location', () => {
  it('TC-33: honours XDG_CONFIG_HOME', () => {
    expect(getConfigPath()).toBe(join(tempConfigRoot, 'opencode', 'opencode.json'));
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(getConfigPath()).toContain(join('.config', 'opencode', 'opencode.json'));
  });
});

describe('opencode add', () => {
  it('writes a remote server entry with the credential header', async () => {
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const entry = (await readConfig()).mcp.ceetrix;
    // opencode's name for an HTTP server is "remote"; "local" takes a command
    // array instead.
    expect(entry.type).toBe('remote');
    expect(entry.url).toBe(TEST_URL);
    expect(entry.headers['X-API-Key']).toBe(TEST_KEY);
    expect(entry.enabled).toBe(true);
  });

  it('TC-31: leaves every unrelated section of a real config untouched', async () => {
    await seedRealisticConfig();
    const before = realisticConfig();

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const after = await readConfig();
    expect(Object.keys(after).sort()).toEqual(
      ['$schema', 'agent', 'compaction', 'mcp', 'model', 'provider'].sort()
    );
    expect(after.$schema).toBe(before.$schema);
    expect(after.agent).toEqual(before.agent);
    expect(after.compaction).toEqual(before.compaction);
    expect(after.model).toBe(before.model);
    // The costly failure: losing the person's credentials for other services.
    expect(after.provider).toEqual(before.provider);
  });

  it('TC-31: keeps an unrelated MCP server alongside ours', async () => {
    await seedRealisticConfig();

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const servers = (await readConfig()).mcp;
    expect(servers.pencil).toEqual(realisticConfig().mcp!['pencil' as never]);
    expect(servers.ceetrix).toBeDefined();
  });

  it('does not loosen the permissions of an existing config', async () => {
    await seedRealisticConfig();

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    expect((await stat(getConfigPath())).mode & 0o777).toBe(OWNER_ONLY_MODE);
  });

  it('creates a new config owner-only, since it holds the credential', async () => {
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    expect((await stat(getConfigPath())).mode & 0o777).toBe(OWNER_ONLY_MODE);
  });

  it('replaces the credential on a second run rather than adding a second entry', async () => {
    await harness.add({ apiKey: 'first_key', url: TEST_URL });
    await harness.add({ apiKey: 'second_key', url: TEST_URL });

    const servers = (await readConfig()).mcp;
    expect(Object.keys(servers)).toEqual(['ceetrix']);
    expect(servers.ceetrix.headers['X-API-Key']).toBe('second_key');
  });
});

describe('opencode annotated config', () => {
  it('TC-32: refuses to touch a .jsonc config and writes nothing', async () => {
    const jsoncBody = '{\n  // my notes\n  "mcp": {}\n}\n';
    await writeFile(getJsoncConfigPath(), jsoncBody, 'utf-8');

    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      HarnessSkipped
    );

    // The annotated file is untouched and no plain-JSON sibling was created.
    expect(await readFile(getJsoncConfigPath(), 'utf-8')).toBe(jsoncBody);
    await expect(readFile(getConfigPath(), 'utf-8')).rejects.toThrow();
  });

  it('TC-32: the refusal names the file and gives the text to paste', async () => {
    await writeFile(getJsoncConfigPath(), '{}', 'utf-8');

    // A refusal is a skip, not a failure: there is something the person can do
    // by hand, and the setup summary must not present it as a bug.
    const error = await harness
      .add({ apiKey: TEST_KEY, url: TEST_URL })
      .then(() => null)
      .catch((e: unknown) => e as InstanceType<typeof HarnessSkipped>);

    expect(error).toBeInstanceOf(HarnessSkipped);
    expect(error!.message).toContain('opencode.jsonc');
    expect(error!.instructions).toContain('"remote"');
    expect(error!.instructions).toContain('opencode.jsonc');
  });

  it('refuses on removal too, rather than half-honouring the annotated file', async () => {
    await writeFile(getJsoncConfigPath(), '{}', 'utf-8');
    await expect(harness.remove()).rejects.toThrow(HarnessSkipped);
  });
});

describe('opencode isConfigured', () => {
  it('is false for a config that has other servers but not ours', async () => {
    await seedRealisticConfig();
    expect(await harness.isConfigured()).toBe(false);
  });

  it('is true after add', async () => {
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    expect(await harness.isConfigured()).toBe(true);
  });

  it('is false rather than throwing when the config will not parse', async () => {
    await writeFile(getConfigPath(), '{ not json', 'utf-8');
    expect(await harness.isConfigured()).toBe(false);
  });
});

describe('opencode remove', () => {
  it('restores a real config to its exact prior bytes', async () => {
    const original = await seedRealisticConfig();

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    await harness.remove();

    expect(await readFile(getConfigPath(), 'utf-8')).toBe(original);
  });

  it('is a no-op when Ceetrix was never added', async () => {
    const original = await seedRealisticConfig();
    await harness.remove();
    expect(await readFile(getConfigPath(), 'utf-8')).toBe(original);
  });
});

describe('opencode unparseable config', () => {
  it('refuses to overwrite it, so the person can repair it', async () => {
    const broken = '{ "mcp": { unclosed';
    await writeFile(getConfigPath(), broken, 'utf-8');

    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /not valid JSON/
    );
    expect(await readFile(getConfigPath(), 'utf-8')).toBe(broken);
  });
});
