/**
 * Unit tests for the omp harness module.
 *
 * Covers TC-27 to TC-30 from the story 547 test strategy.
 *
 * Run against a real temp home rather than a mocked filesystem, for the same
 * reason the shared merge tests are: what matters is what ends up on disk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_KEY = 'test_api_key';
const TEST_URL = 'https://api.ceetrix.com/mcp';

let tempHome: string;

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => process.env.__CEETRIX_TEST_HOME ?? actual.homedir(),
  };
});

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'ceetrix-omp-'));
  process.env.__CEETRIX_TEST_HOME = tempHome;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  vi.resetModules();
});

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
  delete process.env.__CEETRIX_TEST_HOME;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
});

/**
 * Import the module fresh, so a profile set in the environment is picked up.
 *
 * @returns The omp harness module
 */
async function loadOmp() {
  return import('../src/omp.js');
}

/**
 * Read the written config back.
 *
 * @param path - Absolute path to the config file
 * @returns The parsed config
 */
async function readConfig(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf-8'));
}

describe('omp config path', () => {
  it('defaults to the agent directory that omp config path reports', async () => {
    const { getConfigPath } = await loadOmp();
    expect(getConfigPath()).toBe(join(tempHome, '.omp', 'agent', 'mcp.json'));
  });

  it('TC-29: a named profile writes to that profile, leaving the default untouched', async () => {
    process.env.OMP_PROFILE = 'work';
    const { getConfigPath, harness } = await loadOmp();

    expect(getConfigPath()).toBe(
      join(tempHome, '.omp', 'profiles', 'work', 'agent', 'mcp.json')
    );

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const defaultPath = join(tempHome, '.omp', 'agent', 'mcp.json');
    await expect(readFile(defaultPath, 'utf-8')).rejects.toThrow();
    expect((await readConfig(getConfigPath())).mcpServers.ceetrix).toBeDefined();
  });

  it('honours PI_PROFILE too, since omp is a pi fork', async () => {
    process.env.PI_PROFILE = 'forked';
    const { getConfigPath } = await loadOmp();
    expect(getConfigPath()).toContain(join('profiles', 'forked'));
  });
});

describe('omp add', () => {
  it('TC-27: declares the transport explicitly', async () => {
    const { harness, getConfigPath } = await loadOmp();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const entry = (await readConfig(getConfigPath())).mcpServers.ceetrix;
    // Without this, omp treats the entry as a local program and fails with
    // 'stdio server requires "command" field'.
    expect(entry.type).toBe('http');
    expect(entry.url).toBe(TEST_URL);
    expect(entry.headers['X-API-Key']).toBe(TEST_KEY);
  });

  it('never writes a command key, which the schema forbids on an http server', async () => {
    const { harness, getConfigPath } = await loadOmp();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const entry = (await readConfig(getConfigPath())).mcpServers.ceetrix;
    expect(entry).not.toHaveProperty('command');
    expect(entry).not.toHaveProperty('args');
  });

  it('writes the schema reference into a file it creates', async () => {
    const { harness, getConfigPath } = await loadOmp();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    expect((await readConfig(getConfigPath())).$schema).toContain('mcp-schema.json');
  });

  it('adds no schema reference to a file that already existed', async () => {
    // Removal takes out the ceetrix entry and cannot tell whether a $schema
    // key was the person's or ours, so introducing one into someone else's
    // file would make add-then-remove non-restoring.
    const { harness, getConfigPath } = await loadOmp();
    const path = getConfigPath();
    await mkdir(join(tempHome, '.omp', 'agent'), { recursive: true });
    await writeFile(path, JSON.stringify({ mcpServers: {} }), 'utf-8');

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    expect(await readConfig(path)).not.toHaveProperty('$schema');
  });

  it('preserves an unrelated server already in the file', async () => {
    const { harness, getConfigPath } = await loadOmp();
    const path = getConfigPath();
    await mkdir(join(tempHome, '.omp', 'agent'), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ mcpServers: { filesystem: { command: 'npx', args: ['-y', 'fs'] } } }),
      'utf-8'
    );

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const servers = (await readConfig(path)).mcpServers;
    expect(servers.filesystem).toEqual({ command: 'npx', args: ['-y', 'fs'] });
    expect(servers.ceetrix).toBeDefined();
  });
});

describe('omp isConfigured', () => {
  it('is false before anything is written', async () => {
    const { harness } = await loadOmp();
    expect(await harness.isConfigured()).toBe(false);
  });

  it('is true after add', async () => {
    const { harness } = await loadOmp();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    expect(await harness.isConfigured()).toBe(true);
  });

  it('TC-28: stays false when only Claude Code carries Ceetrix', async () => {
    // omp inherits MCP servers from ~/.claude.json, so its tools may already
    // work. isConfigured deliberately reports on omp's own file only: it is
    // the sole reading under which remove() is an honest inverse, and the
    // wizard should still offer to pin the entry into omp's own settings.
    await writeFile(
      join(tempHome, '.claude.json'),
      JSON.stringify({
        mcpServers: { ceetrix: { type: 'http', url: TEST_URL, headers: {} } },
      }),
      'utf-8'
    );

    const { harness } = await loadOmp();
    expect(await harness.isConfigured()).toBe(false);
  });
});

describe('omp remove', () => {
  it('restores the file to its prior bytes', async () => {
    const { harness, getConfigPath } = await loadOmp();
    const path = getConfigPath();
    await mkdir(join(tempHome, '.omp', 'agent'), { recursive: true });
    const original = `${JSON.stringify({ mcpServers: { other: { type: 'http', url: 'https://x' } } }, null, 2)}\n`;
    await writeFile(path, original, 'utf-8');

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    await harness.remove();

    expect(await readFile(path, 'utf-8')).toBe(original);
  });

  it('is a no-op when nothing was ever written', async () => {
    const { harness, getConfigPath } = await loadOmp();
    await harness.remove();
    await expect(readFile(getConfigPath(), 'utf-8')).rejects.toThrow();
  });
});

describe('omp contract', () => {
  it('TC-30: annotated settings are not applicable, so no refusal path exists', async () => {
    // omp's MCP configuration is plain data with no comment form, unlike
    // DeepSeek Harness's. Recorded as an explicit non-behaviour rather than
    // left as a silently missing case.
    const { harness } = await loadOmp();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    expect(await harness.isConfigured()).toBe(true);
  });

  it('reports the restart notice omp actually supports', async () => {
    const { harness } = await loadOmp();
    const notice = harness.restartNotice();
    expect(notice.title).toContain('Restart');
    // omp has no `omp mcp` subcommand: the docs describe one, the shipped
    // binary does not have it. The notice must not send people to it.
    expect(notice.lines.join(' ')).not.toContain('omp mcp list');
  });
});
