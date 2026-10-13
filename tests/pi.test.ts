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
  await installAdapter(ADAPTER_WITH_OWN_FILE);
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

/** The adapter release that moved its config to its own file. */
const ADAPTER_WITH_OWN_FILE = '5.3.0';

/** An adapter release from before that move, which reads pi's mcp.json. */
const ADAPTER_READING_MCP_JSON = '2.34.0';

/** Where the adapter's own user-level config lives, from 3.0.0 on. */
function adapterFilePath(): string {
  return join(tempHome, '.pi', 'agent', 'mcp-adapter.json');
}

/** pi's own user-level MCP config, which adapters before 3.0.0 read. */
function piFilePath(): string {
  return join(tempHome, '.pi', 'agent', 'mcp.json');
}

/** Install directory of the adapter, as `pi list` reports it. */
function adapterDir(): string {
  return join(tempHome, '.pi', 'agent', 'npm', 'node_modules', 'pi-mcp-adapter');
}

/**
 * Put an adapter of the given version where `pi list` will say it is.
 *
 * @param version - The adapter's package.json version
 */
async function installAdapter(version: string): Promise<void> {
  await mkdir(adapterDir(), { recursive: true });
  await writeFile(join(adapterDir(), 'package.json'), JSON.stringify({ name: 'pi-mcp-adapter', version }), 'utf-8');
}

/**
 * Path the installed adapter reads, for the default adapter in these tests.
 *
 * @returns Absolute path
 */
function configPath(): string {
  return adapterFilePath();
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

/**
 * `pi list` output when the adapter is present. Matches the real format.
 *
 * @returns The output, naming this test's adapter directory
 */
function listWithAdapter(): string {
  return `User packages:\n  npm:pi-mcp-adapter\n    ${adapterDir()}\n`;
}

/** `pi list` output when nothing is installed. Matches the real format. */
const LIST_EMPTY = 'No packages installed.\n';

describe('pi add ordering', () => {
  it('TC-23: does not install the adapter again when it is already present', async () => {
    mockRun.mockResolvedValue(listWithAdapter());

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
      .mockResolvedValueOnce(listWithAdapter()) // confirmation
      .mockResolvedValueOnce(listWithAdapter()); // where it is, for its version

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
    mockRun.mockResolvedValue(listWithAdapter());
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
    mockRun.mockResolvedValue(listWithAdapter());
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
    mockRun.mockResolvedValue(listWithAdapter());
    const { harness } = await loadPi();
    expect(await harness.isConfigured()).toBe(false);
  });

  it('reports on the config file, not on whether the adapter is installed', async () => {
    // The adapter being present says nothing about whether Ceetrix is
    // registered; only the file does.
    mockRun.mockResolvedValue(listWithAdapter());
    const { harness } = await loadPi();
    expect(await harness.isConfigured()).toBe(false);
  });
});

describe('pi contract', () => {
  it('TC-26: annotated settings are not applicable, so no refusal path exists', async () => {
    // pi's MCP configuration is plain data with no comment form, unlike
    // DeepSeek Harness's. Recorded as an explicit non-behaviour.
    mockRun.mockResolvedValue(listWithAdapter());
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

describe('pi config file follows the installed adapter', () => {
  // pi-mcp-adapter 3.0.0 stopped reading pi's ~/.pi/agent/mcp.json and reads
  // its own mcp-adapter.json instead. `pi install npm:pi-mcp-adapter` gets the
  // latest release, so a new install wrote a file the adapter never read.

  it('writes the adapter\'s own file, not mcp.json, for adapter 3.0.0 and later', async () => {
    mockRun.mockResolvedValue(listWithAdapter());

    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const entry = JSON.parse(await readFile(adapterFilePath(), 'utf-8')).mcpServers.ceetrix;
    expect(entry.url).toBe(TEST_URL);
    await expect(readFile(piFilePath(), 'utf-8')).rejects.toThrow();
  });

  it('writes mcp.json for an adapter older than 3.0.0, which reads only that file', async () => {
    await installAdapter(ADAPTER_READING_MCP_JSON);
    mockRun.mockResolvedValue(listWithAdapter());

    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const entry = JSON.parse(await readFile(piFilePath(), 'utf-8')).mcpServers.ceetrix;
    expect(entry.url).toBe(TEST_URL);
    await expect(readFile(adapterFilePath(), 'utf-8')).rejects.toThrow();
  });

  it('moves an earlier install\'s entry out of mcp.json and keeps the person\'s own servers there', async () => {
    await mkdir(join(tempHome, '.pi', 'agent'), { recursive: true });
    await writeFile(
      piFilePath(),
      JSON.stringify({ mcpServers: { theirs: { url: 'https://theirs' }, ceetrix: { url: 'https://old' } } }),
      'utf-8'
    );
    mockRun.mockResolvedValue(listWithAdapter());

    const { harness } = await loadPi();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const left = JSON.parse(await readFile(piFilePath(), 'utf-8')).mcpServers;
    expect(left).toEqual({ theirs: { url: 'https://theirs' } });
    expect(JSON.parse(await readFile(adapterFilePath(), 'utf-8')).mcpServers.ceetrix.url).toBe(TEST_URL);
  });

  it('remove takes the entry out of both files', async () => {
    await mkdir(join(tempHome, '.pi', 'agent'), { recursive: true });
    await writeFile(piFilePath(), JSON.stringify({ mcpServers: { ceetrix: { url: 'https://old' } } }), 'utf-8');
    await writeFile(adapterFilePath(), JSON.stringify({ mcpServers: { ceetrix: { url: TEST_URL } } }), 'utf-8');
    mockRun.mockResolvedValue(listWithAdapter());

    const { harness } = await loadPi();
    await harness.remove();

    await expect(readFile(piFilePath(), 'utf-8')).rejects.toThrow();
    await expect(readFile(adapterFilePath(), 'utf-8')).rejects.toThrow();
  });

  it('refuses and writes nothing when the adapter\'s version cannot be read', async () => {
    await rm(join(adapterDir(), 'package.json'));
    mockRun.mockResolvedValue(listWithAdapter());

    const { harness } = await loadPi();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(/version/);
    await expect(readFile(adapterFilePath(), 'utf-8')).rejects.toThrow();
    await expect(readFile(piFilePath(), 'utf-8')).rejects.toThrow();
  });
});
