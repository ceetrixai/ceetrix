/**
 * pi integration — https://pi.dev
 *
 * Verified against pi 0.84.2 on 2026-09-19.
 *
 * pi has no MCP support and, by its author's stated design, will not gain any:
 * the position is that MCP servers carry too much context overhead, and that
 * CLI tools with READMEs are the better shape. MCP therefore arrives through
 * `pi-mcp-adapter`, a community extension published to npm by a third party
 * (github.com/nicobailon/pi-mcp-adapter), not by pi's author.
 *
 * The operator decided that Ceetrix's installer should install that extension
 * rather than only printing instructions. Two consequences are handled here and
 * in permissions.ts: the install is disclosed upfront alongside the commands
 * Ceetrix runs, and it is a real dependency on a third party that Ceetrix does
 * not control.
 *
 * Order matters: the extension is what reads the config, so it is installed
 * first. If the install fails, this module throws rather than writing a config
 * file that nothing would ever read.
 *
 * Which file the extension reads depends on its version. pi-mcp-adapter 3.0.0
 * stopped reading pi's `~/.pi/agent/mcp.json` and reads its own
 * `~/.pi/agent/mcp-adapter.json` instead (same format). `pi install` fetches
 * the latest release, so the file is chosen from the installed version rather
 * than assumed.
 */

import { join } from 'path';
import { homedir } from 'os';
import { readFile } from 'fs/promises';
import {
  cachedBinary,
  runHarnessCommand,
  type Harness,
  type HarnessAddSpec,
  type RestartNotice,
  type ThirdPartyInstall,
} from './harness.js';
import { CEETRIX_MCP_SERVER_NAME } from './constants.js';
import { writeMcpEntry, hasMcpEntry, removeMcpEntry, fileExists } from './json-mcp-config.js';

/** Identifier in the AgentType union. */
export const PI_ID = 'pi';

/** Name shown in the wizard and the not-found message. */
const PI_LABEL = 'pi';

/** Where a user installs it. */
const PI_HOMEPAGE = 'https://pi.dev';

/** Binary name on PATH. */
const PI_COMMAND = 'pi';

/**
 * Marker for the identity probe.
 *
 * `pi --version` prints a bare semver, and `pi` is a short generic name that
 * another program could plausibly claim, so identity is established from the
 * first line of `pi --help`: "pi - AI coding assistant with read, bash, edit,
 * write tools". This check is load-bearing here, not cosmetic — and it depends
 * on help text, which is not a stable interface.
 */
const PI_HELP_MARKER = 'AI coding assistant';

/** Fallback paths. pi is commonly installed under a Node version manager, whose
 * paths are version-specific, so PATH lookup is what usually finds it. */
const COMMON_PI_PATHS = [
  `${process.env.HOME}/.local/bin/pi`,
  '/opt/homebrew/bin/pi',
  '/usr/local/bin/pi',
];

/** Root of pi's user state. */
const PI_HOME_DIR = '.pi';

/** Agent directory under the pi root. */
const PI_AGENT_DIR = 'agent';

/** pi's own MCP config filename, read by adapters before 3.0.0. */
const PI_MCP_FILE = 'mcp.json';

/** The adapter's own config filename, read by adapters from 3.0.0 on. */
const PI_ADAPTER_MCP_FILE = 'mcp-adapter.json';

/** First adapter major version that reads its own file instead of pi's. */
const ADAPTER_OWN_FILE_MAJOR = 3;

/** Top-level key holding the server map. */
const PI_CONTAINER_KEY = 'mcpServers';

/** The extension that gives pi an MCP client, and its install source. */
export const PI_MCP_ADAPTER_PACKAGE = 'pi-mcp-adapter';

/** Argument form `pi install` expects for an npm-published extension. */
export const PI_MCP_ADAPTER_SOURCE = `npm:${PI_MCP_ADAPTER_PACKAGE}`;

/**
 * What pi needs installed, and who publishes it.
 *
 * Published by someone unrelated to pi's own authors, which is worth stating
 * plainly: pi's authors have ruled MCP out of core, so this extension exists
 * against their stated direction and Ceetrix does not control it.
 */
const PI_INSTALLS: readonly ThirdPartyInstall[] = [
  {
    packageName: PI_MCP_ADAPTER_SOURCE,
    publisher: 'nicobailon \u2014 not pi\u2019s authors',
    reason: 'pi has no MCP support, by its authors\u2019 design',
  },
];

const binary = cachedBinary({
  command: PI_COMMAND,
  fallbackPaths: COMMON_PI_PATHS,
  probeArgs: '--help',
  marker: PI_HELP_MARKER,
});

/**
 * Paths of the two user-scope files a pi adapter may read.
 *
 * Ceetrix writes the user-scope file that belongs to pi or its adapter rather
 * than one shared with other tools (`~/.config/mcp/mcp.json`,
 * `~/.agents/...`), and never a project-scope file. Project files outrank it,
 * so a project that defines its own `ceetrix` entry wins; that is the user's
 * choice and is left alone.
 *
 * @returns Absolute paths of pi's mcp.json and the adapter's mcp-adapter.json
 */
function userConfigPaths(): { pi: string; adapter: string } {
  const agentDir = join(homedir(), PI_HOME_DIR, PI_AGENT_DIR);
  return { pi: join(agentDir, PI_MCP_FILE), adapter: join(agentDir, PI_ADAPTER_MCP_FILE) };
}

/**
 * The installed adapter's directory, from `pi list`.
 *
 * `pi list` prints the package source and, on the next line, where it is
 * installed.
 *
 * @returns Absolute directory, or null when the adapter is not listed
 */
async function adapterInstallDir(): Promise<string | null> {
  const path = await binary.get();
  if (!path) return null;
  const lines = (await runHarnessCommand(`"${path}" list`)).split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => l.endsWith(PI_MCP_ADAPTER_PACKAGE));
  return at >= 0 && lines[at + 1] ? lines[at + 1] : null;
}

/**
 * Path of the user-scope config file the installed adapter reads.
 *
 * @returns mcp-adapter.json for adapter 3.0.0 and later, else mcp.json
 * @throws Error when the adapter's version cannot be read; guessing would
 *   risk writing a file the adapter ignores, the failure this exists to stop
 */
export async function getConfigPath(): Promise<string> {
  const dir = await adapterInstallDir();
  const manifest = dir ? join(dir, 'package.json') : null;
  let version: string | undefined;
  try {
    version = manifest ? JSON.parse(await readFile(manifest, 'utf-8')).version : undefined;
  } catch {
    version = undefined;
  }
  const major = version ? Number.parseInt(version.split('.')[0], 10) : Number.NaN;
  if (Number.isNaN(major)) {
    throw new Error(
      `Could not read the installed ${PI_MCP_ADAPTER_PACKAGE} version` +
        `${manifest ? ` from ${manifest}` : ' ("pi list" does not show where it is installed)'}. ` +
        `Its version decides which file it reads, so Ceetrix has not written pi's MCP config.`
    );
  }
  const paths = userConfigPaths();
  return major >= ADAPTER_OWN_FILE_MAJOR ? paths.adapter : paths.pi;
}

/**
 * Is the MCP adapter extension installed?
 *
 * @returns true when `pi list` names the adapter
 */
export async function isAdapterInstalled(): Promise<boolean> {
  const path = await binary.get();
  if (!path) return false;

  try {
    const stdout = await runHarnessCommand(`"${path}" list`);
    return stdout.includes(PI_MCP_ADAPTER_PACKAGE);
  } catch {
    return false;
  }
}

/**
 * Install the MCP adapter extension, unless it is already present.
 *
 * @throws Error when pi is missing, or the install fails or does not take
 */
async function ensureAdapterInstalled(): Promise<void> {
  const path = await binary.get();
  if (!path) {
    throw new Error(`pi not found. Install it: ${PI_HOMEPAGE}`);
  }

  if (await isAdapterInstalled()) {
    return;
  }

  try {
    await runHarnessCommand(`"${path}" install ${PI_MCP_ADAPTER_SOURCE}`);
  } catch (error) {
    throw new Error(
      `Failed to install ${PI_MCP_ADAPTER_SOURCE}, which pi needs in order to speak MCP. ` +
        `pi has no built-in MCP support. Run it yourself and retry:\n` +
        `  pi install ${PI_MCP_ADAPTER_SOURCE}\n` +
        `Underlying error: ${(error as Error).message}`
    );
  }

  // The install command can exit zero without the extension registering.
  // Writing the config in that state would produce a config nothing reads, so
  // the result is checked rather than assumed.
  if (!(await isAdapterInstalled())) {
    throw new Error(
      `Ran "pi install ${PI_MCP_ADAPTER_SOURCE}" but the extension is not listed by "pi list". ` +
        `Ceetrix has not written pi's MCP config, because without the adapter nothing would read it.`
    );
  }
}

/**
 * Build the server entry.
 *
 * No `type` field: the adapter infers an HTTP server from the presence of
 * `url`, and its schema has no `type` key at all.
 *
 * @param spec - API key and MCP endpoint
 * @returns The entry to store under the server name
 */
function buildEntry(spec: HarnessAddSpec): Record<string, unknown> {
  return {
    url: spec.url,
    headers: { 'X-API-Key': spec.apiKey },
  };
}

export const harness = {
  id: PI_ID,
  label: PI_LABEL,
  homepage: PI_HOMEPAGE,

  detect: async () => (await binary.get()) !== '',

  isConfigured: async () =>
    hasMcpEntry({
      filePath: await getConfigPath(),
      containerKey: PI_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
    }),

  add: async (spec: HarnessAddSpec) => {
    await ensureAdapterInstalled();
    const target = await getConfigPath();
    await writeMcpEntry({
      filePath: target,
      containerKey: PI_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
      entry: buildEntry(spec),
    });
    // An earlier install may have written the other file, which this adapter
    // does not read; Ceetrix's own entry there is taken out so only one
    // copy remains. Anything else in that file is the person's and stays.
    for (const other of Object.values(userConfigPaths()).filter((p) => p !== target)) {
      await removeMcpEntry({
        filePath: other,
        containerKey: PI_CONTAINER_KEY,
        serverName: CEETRIX_MCP_SERVER_NAME,
      });
    }
  },

  // The adapter extension is deliberately left installed. Ceetrix did not own
  // pi's MCP support before this, and the adapter may be serving servers the
  // user configured themselves; uninstalling it would take those down too.
  // Both files are cleared, so removal works whichever one an earlier install
  // wrote and needs no adapter version.
  remove: async () => {
    for (const filePath of Object.values(userConfigPaths())) {
      await removeMcpEntry({
        filePath,
        containerKey: PI_CONTAINER_KEY,
        serverName: CEETRIX_MCP_SERVER_NAME,
      });
    }
  },

  restartNotice: (): RestartNotice => ({
    title: `Restart ${PI_LABEL} to activate Ceetrix`,
    lines: [
      'Quit and reopen pi, then describe a feature you',
      'want to build and ask it to "create a story for it".',
      '',
      `MCP reaches pi through ${PI_MCP_ADAPTER_PACKAGE}, a third-party`,
      'extension that Ceetrix installed and does not maintain.',
      '',
      'To check it, run /mcp tools inside pi, or from a shell:',
      "  pi -p 'call the ceetrix search tool'",
    ],
  }),

  diagnose: async () => {
    const path = await binary.get();
    const configPath = await getConfigPath().catch((error: Error) => error.message);
    return [
      `binary: ${path || 'not found'}`,
      `adapter: ${(await isAdapterInstalled()) ? PI_MCP_ADAPTER_PACKAGE : 'not installed'}`,
      `config: ${configPath}${(await fileExists(configPath)) ? '' : ' (absent)'}`,
    ];
  },

  installs: PI_INSTALLS,

  resetCache: () => binary.reset(),
} satisfies Harness;
