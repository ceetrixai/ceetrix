/**
 * DeepSeek Harness integration: patch a profile → dsh composes it → the plugin
 * is mounted with our configuration.
 *
 * This is the strongest probe of the four harnesses added in story 547:
 * `--dump-config` is explicit, documented and non-interactive, and it shows the
 * composed tree rather than just the file we wrote.
 *
 * dsh honours a home-directory override, and its whole state directory is small
 * (a few hundred KB, since dependencies are linked rather than copied), so the
 * test copies the developer's real dsh home into a temp tree and works there.
 * That gives real profiles with real bundles to compose, at no risk to the
 * original — which is verified at the end of the round trip.
 *
 * It installs a plugin from a package registry, so it needs network. That is
 * inherent: whether the pinned version resolves is one of the two risks this
 * suite exists to check, and stubbing the registry would hide exactly that.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp, readFile, stat } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import which from 'which';

const execFileAsync = promisify(execFile);

const TEST_API_KEY = 'test_api_key_not_real';
const TEST_MCP_URL = 'https://api.ceetrix.com/mcp';

/** Installing a plugin fetches from a registry, so this is generous. */
const DSH_TIMEOUT_MS = 600000;

let dshPath: string | null = null;
let hasRealDshHome = false;
let tempDshHome: string;

/**
 * Find the dsh binary, or null when it is not installed.
 *
 * @returns Path to the binary, or null
 */
async function findDsh(): Promise<string | null> {
  try {
    return await which('dsh');
  } catch {
    return null;
  }
}

/**
 * Run the harness module against the temp dsh home.
 *
 * @param action - Which lifecycle method to call
 */
async function viaHarness(action: 'add' | 'remove'): Promise<void> {
  const previous = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = tempDshHome;
    const { harness } = await import('../src/dsh.js');
    if (action === 'add') {
      await harness.add({ apiKey: TEST_API_KEY, url: TEST_MCP_URL });
    } else {
      await harness.remove();
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
}

/**
 * Compose one profile and return the resulting tree.
 *
 * @param profile - Profile name
 * @returns The composed configuration as text
 */
async function dumpConfig(profile: string): Promise<string> {
  const { stdout } = await execFileAsync(
    dshPath!,
    ['--profile', profile, '--dump-config'],
    { timeout: DSH_TIMEOUT_MS, env: { ...process.env, DSH_HOME: tempDshHome }, maxBuffer: 1024 * 1024 * 8 }
  );
  return stdout;
}

/**
 * Should these tests run?
 *
 * @returns true when dsh and a real profile tree are both present
 */
function canRun(): boolean {
  return dshPath !== null && hasRealDshHome;
}

describe('DeepSeek Harness integration: patch → compose → mounted', () => {
  beforeAll(async () => {
    dshPath = await findDsh();
    try {
      await stat(join(homedir(), '.dsh', 'profiles'));
      hasRealDshHome = true;
    } catch {
      hasRealDshHome = false;
    }
  });

  beforeEach(async () => {
    if (!canRun()) return;
    tempDshHome = await mkdtemp(join(tmpdir(), 'dsh-integration-'));
    // Copy rather than mutate: the developer's own profiles carry their real
    // routing choices and their own written notes.
    await cp(join(homedir(), '.dsh'), tempDshHome, { recursive: true });
  });

  afterEach(async () => {
    if (!canRun()) return;
    await rm(tempDshHome, { recursive: true, force: true });
  });

  it('pins the plugin to the installed core bundle, not the registry default', async () => {
    if (!canRun()) {
      console.log('Skipping: dsh or a dsh profile tree not present');
      return;
    }

    const previous = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = tempDshHome;
      const { pinnedPluginVersion } = await import('../src/dsh.js');
      const pinned = await pinnedPluginVersion();

      const core = JSON.parse(
        await readFile(
          join(tempDshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'),
          'utf-8'
        )
      ) as { version: string };

      // The plugin's `latest` tag trails the harness by several minor
      // versions, so accepting the default would install a mismatch.
      expect(pinned).toBe(core.version);
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    }
  });

  it('dsh composes the profile with the ceetrix plugin mounted', async () => {
    if (!canRun()) {
      console.log('Skipping: dsh or a dsh profile tree not present');
      return;
    }

    await viaHarness('add');
    const composed = await dumpConfig('web');

    // The two entries Ceetrix writes — one mounting the plugin, one
    // configuring it by id — are merged by dsh into a single mounted
    // instance. That is what settles whether the two-entry shape is valid.
    expect(composed).toContain('ceetrix-mcp');
    expect(composed).toContain('@deepseek-ai/dsh-mcp-client');
    expect(composed).toContain('serverName: ceetrix');
    expect(composed).toContain('transport: streamable-http');
  }, DSH_TIMEOUT_MS);

  it('composes without the entry before anything is written', async () => {
    if (!canRun()) {
      console.log('Skipping: dsh or a dsh profile tree not present');
      return;
    }

    expect(await dumpConfig('web')).not.toContain('ceetrix-mcp');
  }, DSH_TIMEOUT_MS);

  it('removal restores every profile patch to its exact prior bytes', async () => {
    if (!canRun()) {
      console.log('Skipping: dsh or a dsh profile tree not present');
      return;
    }

    const { discoverProfiles, getPatchPath } = await import('../src/dsh.js');
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = tempDshHome;
    const profiles = await discoverProfiles();

    const before = new Map<string, string | null>();
    for (const profile of profiles) {
      before.set(profile, await readFile(getPatchPath(profile), 'utf-8').catch(() => null));
    }
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;

    await viaHarness('add');
    await viaHarness('remove');

    process.env.DSH_HOME = tempDshHome;
    for (const profile of profiles) {
      const after = await readFile(getPatchPath(profile), 'utf-8').catch(() => null);
      // Byte equality, comments included. These files carry the developer's
      // own prose explaining their routing choices.
      expect(after, profile).toBe(before.get(profile));
    }
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }, DSH_TIMEOUT_MS);
});
