/**
 * Unit tests for the pi harness module.
 *
 * Covers TC-22 to TC-26 from the story 547 test strategy.
 *
 * pi is the only harness whose connection depends on installing something
 * first, so most of these tests are about the ordering: the adapter extension
 * is what reads mcp.json, and a settings file written without it would be a
 * config nothing reads behind an installer reporting success.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_KEY = 'test_api_key';
const TEST_URL = 'https://api.ceetrix.com/mcp';

let tempHome: string;

/** Path the mocked binary probe resolves to; empty means pi is absent. */
let binaryPath = '/fake/bin/pi';

/** Stands in for every command the module runs against pi. */
const mockRun = vi.fn();

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => process.env.__CEETRIX_TEST_HOME ?? actual.homedir(),
  };
});

vi.mock('../src/harness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/harness.js')>();
  return {
    ...actual,
    cachedBinary: () => ({
      get: async () => binaryPath,
      reset: () => {},
    }),
    runHarnessCommand: (command: string) => mockRun(command),
  };
});

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'ceetrix-pi-'));
  process.env.__CEETRIX_TEST_HOME = tempHome;
  binaryPath = '/fake/bin/pi';
  mockRun.mockReset();
  vi.resetModules();
});

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
  delete process.env.__CEETRIX_TEST_HOME;
});

/**
 * Import the module fresh.
 *
 * @returns The pi harness module
 */
async function loadPi() {
  return import('../src/pi.js');
}

/**
 * Path pi's user-level MCP config should be written to.
 *
 * @returns Absolute path
 */
function configPath(): string {
  return join(tempHome, '.pi', 'agent', 'mcp.json');
}

/**
 * Does the config file exist?
 *
 * @returns true when it can be read
 */
async function configExists(): Promise<boolean> {
  try {
    await readFile(configPath(), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** `pi list` output when the adapter is present. Matches the real format. */
const LIST_WITH_ADAPTER =
  'User packages:\n  npm:pi-mcp-adapter\n    /home/someone/.pi/agent/npm/node_modules/pi-mcp-adapter\n';

/** `pi list` output when nothing is installed. Matches the real format. */
const LIST_EMPTY = 'No packages installed.\n';

describe('pi add ordering', () => {
  it('TC-23: does not install the adapter again when it is already present', async () => {
    mockRun.mockResolvedValue(LIST_WITH_ADAPTER);

    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const installCalls = mockRun.mock.calls.filter(([cmd]) => String(cmd).includes('install'));
    expect(installCalls).toHaveLength(0);
    expect(await configExists()).toBe(true);
  });

  it('installs the adapter when absent, then writes the config', async () => {
    mockRun
      .mockResolvedValueOnce(LIST_EMPTY) // first check: absent
      .mockResolvedValueOnce('Installed') // the install
      .mockResolvedValueOnce(LIST_WITH_ADAPTER); // confirmation

    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const commands = mockRun.mock.calls.map(([cmd]) => String(cmd));
    expect(commands.some((c) => c.includes('install') && c.includes('pi-mcp-adapter'))).toBe(true);
    expect(await configExists()).toBe(true);
  });

  it('TC-22: writes no config when the adapter install fails', async () => {
    mockRun
      .mockResolvedValueOnce(LIST_EMPTY)
      .mockRejectedValueOnce(new Error('registry unreachable'));

    const { harness } = await loadPi();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /Failed to install/
    );

    // The adapter is what reads this file. Writing it here would leave an
    // installer reporting success over a pi with no Ceetrix in it.
    expect(await configExists()).toBe(false);
  });

  it('TC-22: the install failure tells the person the command to run themselves', async () => {
    mockRun
      .mockResolvedValueOnce(LIST_EMPTY)
      .mockRejectedValueOnce(new Error('registry unreachable'));

    const { harness } = await loadPi();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /pi install/
    );
  });

  it('TC-24: treats an install that exits zero without registering as a failure', async () => {
    mockRun
      .mockResolvedValueOnce(LIST_EMPTY) // absent
      .mockResolvedValueOnce('') // install "succeeds"
      .mockResolvedValueOnce(LIST_EMPTY); // still absent

    const { harness } = await loadPi();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /not listed by "pi list"/
    );
    expect(await configExists()).toBe(false);
  });

  it('refuses when pi itself is absent', async () => {
    binaryPath = '';

    const { harness } = await loadPi();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /pi not found/
    );
    expect(await configExists()).toBe(false);
  });
});

describe('pi entry shape', () => {
  beforeEach(() => {
    mockRun.mockResolvedValue(LIST_WITH_ADAPTER);
  });

  it('writes url and credential header, and no type key', async () => {
    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const entry = JSON.parse(await readFile(configPath(), 'utf-8')).mcpServers.ceetrix;
    expect(entry.url).toBe(TEST_URL);
    expect(entry.headers['X-API-Key']).toBe(TEST_KEY);
    // The adapter infers an HTTP server from the presence of url; its schema
    // has no type key at all, unlike omp's and OpenCode's.
    expect(entry).not.toHaveProperty('type');
  });

  it('preserves a server the person configured themselves', async () => {
    await mkdir(join(tempHome, '.pi', 'agent'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({ mcpServers: { theirs: { url: 'https://theirs' } } }),
      'utf-8'
    );

    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const servers = JSON.parse(await readFile(configPath(), 'utf-8')).mcpServers;
    expect(servers.theirs).toEqual({ url: 'https://theirs' });
    expect(servers.ceetrix).toBeDefined();
  });
});

describe('pi remove', () => {
  beforeEach(() => {
    mockRun.mockResolvedValue(LIST_WITH_ADAPTER);
  });

  it('TC-25: removes the connection and does not uninstall the adapter', async () => {
    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    mockRun.mockClear();

    await harness.remove();

    expect(await harness.isConfigured()).toBe(false);
    // The adapter may be serving servers the person added themselves;
    // uninstalling it would take those down too.
    const removeCalls = mockRun.mock.calls.filter(([cmd]) =>
      String(cmd).includes('remove')
    );
    expect(removeCalls).toHaveLength(0);
  });

  it('leaves a server the person configured themselves in place', async () => {
    const { harness } = await loadPi();
    await mkdir(join(tempHome, '.pi', 'agent'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({ mcpServers: { theirs: { url: 'https://theirs' } } }),
      'utf-8'
    );

    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    await harness.remove();

    const servers = JSON.parse(await readFile(configPath(), 'utf-8')).mcpServers;
    expect(servers.theirs).toEqual({ url: 'https://theirs' });
    expect(servers.ceetrix).toBeUndefined();
  });
});

describe('pi isConfigured', () => {
  it('is false before anything is written', async () => {
    mockRun.mockResolvedValue(LIST_WITH_ADAPTER);
    const { harness } = await loadPi();
    expect(await harness.isConfigured()).toBe(false);
  });

  it('reports on the config file, not on whether the adapter is installed', async () => {
    // The adapter being present says nothing about whether Ceetrix is
    // registered; only the file does.
    mockRun.mockResolvedValue(LIST_WITH_ADAPTER);
    const { harness } = await loadPi();
    expect(await harness.isConfigured()).toBe(false);
  });
});

describe('pi contract', () => {
  it('TC-26: annotated settings are not applicable, so no refusal path exists', async () => {
    // pi's MCP configuration is plain data with no comment form, unlike
    // DeepSeek Harness's. Recorded as an explicit non-behaviour.
    mockRun.mockResolvedValue(LIST_WITH_ADAPTER);
    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    expect(await harness.isConfigured()).toBe(true);
  });

  it('names the third-party extension in the restart notice', async () => {
    const { harness } = await loadPi();
    const notice = harness.restartNotice();
    // The person agreed to a third-party install; the notice should not then
    // be silent about what is now on their machine.
    expect(notice.lines.join(' ')).toContain('pi-mcp-adapter');
    expect(notice.lines.join(' ')).toContain('third-party');
  });
});
