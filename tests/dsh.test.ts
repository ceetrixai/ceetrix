/**
 * Unit tests for the DeepSeek Harness module.
 *
 * Covers TC-34 to TC-37 from the story 547 test strategy.
 *
 * dsh is the only harness that keeps several independent configurations, so
 * most of these are about doing the same thing to every one of them and about
 * failing loudly rather than quietly installing a mismatched plugin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';

const TEST_KEY = 'test_api_key';
const TEST_URL = 'https://api.ceetrix.com/mcp';

/** The version the core bundle reports, which the plugin must be pinned to. */
const CORE_VERSION = '0.1.5-rc.2';

/** Path the mocked binary probe resolves to; empty means dsh is absent. */
let binaryPath = '/fake/bin/dsh';

/** Stands in for every command the module runs against dsh. */
const mockRun = vi.fn();

let tempHome: string;

vi.mock('../src/harness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/harness.js')>();
  return {
    ...actual,
    cachedBinary: () => ({ get: async () => binaryPath, reset: () => {} }),
    runHarnessCommand: (command: string) => mockRun(command),
  };
});

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'ceetrix-dsh-'));
  process.env.DSH_HOME = tempHome;
  binaryPath = '/fake/bin/dsh';
  mockRun.mockReset();
  mockRun.mockResolvedValue('');
  vi.resetModules();
});

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
  delete process.env.DSH_HOME;
});

/**
 * Import the module fresh.
 *
 * @returns The dsh harness module
 */
async function loadDsh() {
  return import('../src/dsh.js');
}

/**
 * Create a profile directory with a manifest.
 *
 * @param name - Profile name
 * @param dependencies - Manifest dependencies
 */
async function makeProfile(
  name: string,
  dependencies: Record<string, string> = {}
): Promise<void> {
  const dir = join(tempHome, 'profiles', name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: `dsh-profile-${name}`, dependencies }),
    'utf-8'
  );
}

/**
 * Create the installed core bundle whose version the plugin pins to.
 *
 * @param version - Version to report, or null to omit the bundle entirely
 */
async function makeCoreBundle(version: string | null = CORE_VERSION): Promise<void> {
  if (version === null) return;
  const dir = join(tempHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-base');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ version }), 'utf-8');
}

/**
 * Read one profile's adjustment file.
 *
 * @param name - Profile name
 * @returns The parsed entry list
 */
async function readPatch(name: string): Promise<any[]> {
  const body = await readFile(join(tempHome, 'profiles', name, 'cordis.patch.yml'), 'utf-8');
  return parse(body) as any[];
}

describe('dsh profile discovery', () => {
  it('finds every directory carrying a manifest', async () => {
    await makeProfile('web');
    await makeProfile('headless');

    const { discoverProfiles } = await loadDsh();
    expect(await discoverProfiles()).toEqual(['headless', 'web']);
  });

  it('ignores the shared dependency store, which is not a profile', async () => {
    await makeProfile('web');
    await mkdir(join(tempHome, 'profiles', 'node_modules', 'something'), { recursive: true });

    const { discoverProfiles } = await loadDsh();
    expect(await discoverProfiles()).toEqual(['web']);
  });

  it('honours DSH_HOME', async () => {
    await makeProfile('only');
    const { getPatchPath } = await loadDsh();
    expect(getPatchPath('only')).toBe(
      join(tempHome, 'profiles', 'only', 'cordis.patch.yml')
    );
  });

  it('TC-36: reports no profiles rather than crashing', async () => {
    const { discoverProfiles, harness } = await loadDsh();
    expect(await discoverProfiles()).toEqual([]);
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /No DeepSeek Harness profiles found/
    );
  });
});

describe('dsh version pinning', () => {
  it('reads the pin from the installed core bundle, not the launcher', async () => {
    await makeCoreBundle();
    const { pinnedPluginVersion } = await loadDsh();
    expect(await pinnedPluginVersion()).toBe(CORE_VERSION);
  });

  it('TC-37: fails loudly when the core bundle cannot be read', async () => {
    await makeProfile('web');
    await makeCoreBundle(null);

    const { harness } = await loadDsh();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /cannot pin/
    );
  });

  it('TC-37: never falls back to the plugin default version', async () => {
    // The plugin's default published version is several releases behind the
    // installed harness, so a fallback would quietly install a mismatch.
    await makeProfile('web');
    await makeCoreBundle(null);

    const { harness } = await loadDsh();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow();

    const installs = mockRun.mock.calls.filter(([cmd]) => String(cmd).includes('add'));
    expect(installs).toHaveLength(0);
  });

  it('installs the plugin at the pinned version', async () => {
    await makeProfile('web');
    await makeCoreBundle();

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const install = mockRun.mock.calls.map(([c]) => String(c)).find((c) => c.includes('add'));
    expect(install).toContain(`@deepseek-ai/dsh-mcp-client@${CORE_VERSION}`);
    expect(install).toContain('--profile web');
  });
});

describe('dsh add', () => {
  it('TC-34: connects every profile on the machine', async () => {
    await makeProfile('web');
    await makeProfile('headless');
    await makeCoreBundle();

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    for (const name of ['web', 'headless']) {
      const entries = await readPatch(name);
      expect(entries.find((e) => e.insert)?.insert[0].id).toBe('ceetrix-mcp');
      expect(entries.find((e) => e.config)?.config.serverName).toBe('ceetrix');
    }
  });

  it('TC-34: installs the plugin into every profile, since scope must match', async () => {
    await makeProfile('web');
    await makeProfile('headless');
    await makeCoreBundle();

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const installs = mockRun.mock.calls.map(([c]) => String(c)).filter((c) => c.includes('add'));
    expect(installs).toHaveLength(2);
    expect(installs.some((c) => c.includes('--profile web'))).toBe(true);
    expect(installs.some((c) => c.includes('--profile headless'))).toBe(true);
  });

  it('does not reinstall a plugin the profile already depends on', async () => {
    await makeProfile('web', { '@deepseek-ai/dsh-mcp-client': CORE_VERSION });
    await makeCoreBundle();

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const installs = mockRun.mock.calls.map(([c]) => String(c)).filter((c) => c.includes('add'));
    expect(installs).toHaveLength(0);
  });

  it('uses dsh transport naming, not omp\'s or OpenCode\'s', async () => {
    await makeProfile('web');
    await makeCoreBundle();

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const configure = (await readPatch('web')).find((e) => e.config);
    expect(configure.config.transport).toBe('streamable-http');
    expect(configure.config.headers['X-API-Key']).toBe(TEST_KEY);
  });

  it('TC-35: keeps the notes the person wrote in a profile patch', async () => {
    await makeProfile('web');
    await makeCoreBundle();
    const notes = '# why this profile routes the way it does\n- id: web\n  config:\n    a: b\n';
    await writeFile(join(tempHome, 'profiles', 'web', 'cordis.patch.yml'), notes, 'utf-8');

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });

    const after = await readFile(
      join(tempHome, 'profiles', 'web', 'cordis.patch.yml'),
      'utf-8'
    );
    expect(after).toContain('# why this profile routes the way it does');
  });

  it('reports a failed plugin install with the command to run by hand', async () => {
    await makeProfile('web');
    await makeCoreBundle();
    mockRun.mockRejectedValue(new Error('registry unreachable'));

    const { harness } = await loadDsh();
    await expect(harness.add({ apiKey: TEST_KEY, url: TEST_URL })).rejects.toThrow(
      /dsh plugin --profile web add/
    );
  });
});

describe('dsh isConfigured', () => {
  it('is false before anything is written', async () => {
    await makeProfile('web');
    const { harness } = await loadDsh();
    expect(await harness.isConfigured()).toBe(false);
  });

  it('is true when at least one profile carries the entry', async () => {
    await makeProfile('web');
    await makeProfile('headless');
    await makeCoreBundle();

    const { harness, getPatchPath } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    await rm(getPatchPath('headless'));

    // One profile is enough, so the all-configured branch of setup keeps its
    // meaning without every harness having to model sub-targets.
    expect(await harness.isConfigured()).toBe(true);
  });
});

describe('dsh remove', () => {
  it('clears every profile', async () => {
    await makeProfile('web');
    await makeProfile('headless');
    await makeCoreBundle();

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    await harness.remove();

    expect(await harness.isConfigured()).toBe(false);
  });

  it('restores a profile patch to its exact prior bytes', async () => {
    await makeProfile('web');
    await makeCoreBundle();
    const original = '# keep me\n- id: web\n  config:\n    a: b\n';
    await writeFile(join(tempHome, 'profiles', 'web', 'cordis.patch.yml'), original, 'utf-8');

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    await harness.remove();

    expect(
      await readFile(join(tempHome, 'profiles', 'web', 'cordis.patch.yml'), 'utf-8')
    ).toBe(original);
  });

  it('does not uninstall the plugin', async () => {
    await makeProfile('web');
    await makeCoreBundle();

    const { harness } = await loadDsh();
    await harness.add({ apiKey: TEST_KEY, url: TEST_URL });
    mockRun.mockClear();
    await harness.remove();

    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('dsh restart notice', () => {
  it('names the verification command and the preview status', async () => {
    const { harness } = await loadDsh();
    const notice = harness.restartNotice();
    expect(notice.lines.join(' ')).toContain('--dump-config');
    // dsh's own documentation expects breaking changes; a person should not
    // have to discover that when their setup stops working.
    expect(notice.lines.join(' ')).toContain('developer preview');
  });
});
