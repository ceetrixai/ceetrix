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
 * Order matters: the extension is what reads mcp.json, so it is installed
 * first. If the install fails, this module throws rather than writing a config
 * file that nothing would ever read.
 */

import { join } from 'path';
import { homedir } from 'os';
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

/** MCP config filename read by the adapter. */
const PI_MCP_FILE = 'mcp.json';

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
 * Path to the pi-owned user-scope MCP config file.
 *
 * The adapter reads six files in ascending precedence:
 * `~/.config/mcp/mcp.json`, `~/.agents/mcp.json`, `~/.agents/mcp/mcp.json`,
 * `~/.pi/agent/mcp.json`, `.mcp.json`, `.pi/mcp.json`. Ceetrix writes the
 * fourth: the highest-precedence file that is pi's own rather than shared with
 * other tools, and user-scoped rather than committed into a project.
 *
 * The two project-scope files outrank it, so a project that defines its own
 * `ceetrix` entry wins. That is the user's choice and is left alone.
 *
 * @returns Absolute path to pi's user-level mcp.json
 */
export function getConfigPath(): string {
  return join(homedir(), PI_HOME_DIR, PI_AGENT_DIR, PI_MCP_FILE);
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
  // Writing mcp.json in that state would produce a config nothing reads, so
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
      filePath: getConfigPath(),
      containerKey: PI_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
    }),

  add: async (spec: HarnessAddSpec) => {
    await ensureAdapterInstalled();
    await writeMcpEntry({
      filePath: getConfigPath(),
      containerKey: PI_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
      entry: buildEntry(spec),
    });
  },

  // The adapter extension is deliberately left installed. Ceetrix did not own
  // pi's MCP support before this, and the adapter may be serving servers the
  // user configured themselves; uninstalling it would take those down too.
  remove: async () => {
    await removeMcpEntry({
      filePath: getConfigPath(),
      containerKey: PI_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
    });
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
    const configPath = getConfigPath();
    return [
      `binary: ${path || 'not found'}`,
      `adapter: ${(await isAdapterInstalled()) ? PI_MCP_ADAPTER_PACKAGE : 'not installed'}`,
      `config: ${configPath}${(await fileExists(configPath)) ? '' : ' (absent)'}`,
    ];
  },

  installs: PI_INSTALLS,

  resetCache: () => binary.reset(),
} satisfies Harness;
