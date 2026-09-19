/**
 * pi and omp integration, and an honest statement of where it stops.
 *
 * These two are grouped because they share a limitation that the other
 * harnesses do not: **neither exposes a non-interactive way to list its MCP
 * servers.** pi has no `mcp` subcommand and the adapter's own CLI offers only
 * `init` and token management; omp's `/mcp` commands exist solely inside the
 * interactive session, and the `omp mcp` subcommand its published docs
 * describe does not exist in the shipped binary.
 *
 * So a passing run here means the extension registered and the settings file
 * is correct. It does NOT mean Ceetrix's tools reached the model. That
 * confirmation is a manual step, recorded in the runbook. The test names are
 * written so they cannot be mistaken for the stronger claim.
 *
 * Everything runs against a temp HOME, so the developer's own pi and omp
 * state is never read or written.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import which from 'which';
import * as piModule from '../src/pi.js';
import * as ompModule from '../src/omp.js';

const execFileAsync = promisify(execFile);

const TEST_API_KEY = 'test_api_key_not_real';
const TEST_MCP_URL = 'https://api.ceetrix.com/mcp';

/** Installing a pi extension fetches from a registry. */
const INSTALL_TIMEOUT_MS = 600000;

/** A plain probe of an installed binary. */
const PROBE_TIMEOUT_MS = 60000;

let piPath: string | null = null;
let ompPath: string | null = null;
let tempHome: string;

/**
 * Look a binary up, or null when it is absent.
 *
 * @param command - Command name
 * @returns Path, or null
 */
async function find(command: string): Promise<string | null> {
  try {
    return await which(command);
  } catch {
    return null;
  }
}

/**
 * Run a harness module's method with HOME pointed at the temp tree.
 *
 * Returns the config path resolved INSIDE the override. Resolving it after
 * HOME is restored would name the developer's real settings file, which a
 * caller could then read or assert against by accident.
 *
 * @param moduleName - 'pi' or 'omp'
 * @param action - Lifecycle method to call
 * @returns The config path inside the temp home
 */
async function viaHarness(
  moduleName: 'pi' | 'omp',
  action: 'add' | 'remove' | 'none'
): Promise<string> {
  const mod = moduleName === 'pi' ? piModule : ompModule;
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = tempHome;
    if (action === 'add') {
      await mod.harness.add({ apiKey: TEST_API_KEY, url: TEST_MCP_URL });
    } else if (action === 'remove') {
      await mod.harness.remove();
    }
    return mod.getConfigPath();
  } finally {
    process.env.HOME = previousHome;
  }
}

beforeAll(async () => {
  piPath = await find('pi');
  ompPath = await find('omp');
});

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'pi-omp-integration-'));
});

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
});

describe('pi integration: extension registers and the settings file is written', () => {
  it('identifies the real pi binary from its help text', async () => {
    if (!piPath) {
      console.log('Skipping: pi not installed');
      return;
    }

    const { stdout } = await execFileAsync(piPath, ['--help'], { timeout: PROBE_TIMEOUT_MS });
    // pi --version is a bare semver, so identity comes from this line.
    expect(stdout).toContain('AI coding assistant');
  }, PROBE_TIMEOUT_MS);

  it('installs the adapter into a temp home and pi then lists it', async () => {
    if (!piPath) {
      console.log('Skipping: pi not installed');
      return;
    }

    const configPath = await viaHarness('pi', 'add');

    const { stdout } = await execFileAsync(piPath, ['list'], {
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, HOME: tempHome },
    });
    expect(stdout).toContain('pi-mcp-adapter');

    const written = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(written.mcpServers.ceetrix.url).toBe(TEST_MCP_URL);
    // The adapter infers HTTP from the url; its schema has no type key.
    expect(written.mcpServers.ceetrix).not.toHaveProperty('type');
  }, INSTALL_TIMEOUT_MS);

  it('removal leaves the settings gone and the adapter still installed', async () => {
    if (!piPath) {
      console.log('Skipping: pi not installed');
      return;
    }

    await viaHarness('pi', 'add');
    await viaHarness('pi', 'remove');

    const { stdout } = await execFileAsync(piPath, ['list'], {
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, HOME: tempHome },
    });
    // Ceetrix did not own pi's MCP support before, and the adapter may serve
    // servers the person added themselves.
    expect(stdout).toContain('pi-mcp-adapter');

    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;
    expect(await piModule.harness.isConfigured()).toBe(false);
    process.env.HOME = previousHome;
  }, INSTALL_TIMEOUT_MS);

  it('has no non-interactive way to confirm the tools reached the model', async () => {
    if (!piPath) {
      console.log('Skipping: pi not installed');
      return;
    }

    // Asserted rather than assumed, because if pi ever gains such a command
    // this suite should be strengthened rather than left understating itself.
    const { stdout } = await execFileAsync(piPath, ['--help'], { timeout: PROBE_TIMEOUT_MS });
    expect(stdout).not.toMatch(/^\s+pi mcp /m);
  }, PROBE_TIMEOUT_MS);
});

describe('omp integration: the settings file is written where omp reads it', () => {
  it('identifies the real omp binary from its version string', async () => {
    if (!ompPath) {
      console.log('Skipping: omp not installed');
      return;
    }

    const { stdout } = await execFileAsync(ompPath, ['--version'], { timeout: PROBE_TIMEOUT_MS });
    // omp is the only one of the four that names itself in --version.
    expect(stdout).toContain('omp/');
  }, PROBE_TIMEOUT_MS);

  it('writes to the path omp itself reports as its agent directory', async () => {
    if (!ompPath) {
      console.log('Skipping: omp not installed');
      return;
    }

    const { stdout } = await execFileAsync(ompPath, ['config', 'path'], {
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, HOME: tempHome },
    });
    const reported = stdout.trim();

    const configPath = await viaHarness('omp', 'add');
    expect(configPath).toBe(join(reported, 'mcp.json'));

    const written = JSON.parse(await readFile(configPath, 'utf-8'));
    // Without an explicit transport, omp treats the entry as a local program
    // and fails asking for a command to run.
    expect(written.mcpServers.ceetrix.type).toBe('http');
    expect(written.mcpServers.ceetrix.url).toBe(TEST_MCP_URL);
  }, PROBE_TIMEOUT_MS);

  it('add then remove leaves no settings file where none existed', async () => {
    if (!ompPath) {
      console.log('Skipping: omp not installed');
      return;
    }

    const path = await viaHarness('omp', 'add');
    expect(await readFile(path, 'utf-8')).toBeTruthy();

    await viaHarness('omp', 'remove');
    await expect(readFile(path, 'utf-8')).rejects.toThrow();
  }, PROBE_TIMEOUT_MS);

  it('has no mcp subcommand, contrary to its published documentation', async () => {
    if (!ompPath) {
      console.log('Skipping: omp not installed');
      return;
    }

    // The docs on the project's main branch describe `omp mcp list`. The
    // shipped binary falls through to the default launch help instead. This
    // assertion exists so that if omp ever gains the command, this suite is
    // strengthened rather than quietly left weaker than it could be.
    const { stdout } = await execFileAsync(ompPath, ['--help'], { timeout: PROBE_TIMEOUT_MS });
    const commandsSection = stdout.slice(stdout.indexOf('COMMANDS'));
    expect(commandsSection).not.toMatch(/^\s+mcp\s/m);
  }, PROBE_TIMEOUT_MS);
});
