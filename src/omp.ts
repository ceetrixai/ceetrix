/**
 * omp (Oh My Pi) integration — https://omp.sh
 *
 * omp is a fork of pi with MCP support built in, so unlike pi it needs no
 * third-party adapter.
 *
 * Verified against omp v18.2.6 on 2026-09-19. Two facts from that install
 * contradict the project's documentation on GitHub main and are the reason
 * this module looks the way it does:
 *
 *   1. There is no `omp mcp` subcommand. `omp mcp --help` falls through to the
 *      default launch help. The /mcp add|list|test commands exist only as
 *      slash commands inside the TUI, so configuration is a file write and
 *      there is no non-interactive command to verify it with.
 *   2. `omp --version` prints `omp/18.2.6`, a real product marker. omp is the
 *      only one of the four new harnesses that can be identified from its
 *      version string rather than its help text.
 *
 * The authority for the file format is the copy of the docs shipped inside the
 * binary, readable with `omp read omp://mcp-config.md`, not the GitHub tree.
 *
 * Inheritance caveat: omp discovers MCP servers from other tools' configs,
 * including ~/.claude.json, ~/.codex/config.toml and opencode.json. A user who
 * has already registered Ceetrix with any of those reaches it from omp without
 * this module. Writing omp's own file still matters — it serves users who have
 * only omp, and OMP-native config is the highest-priority source, so the entry
 * written here shadows an inherited one rather than duplicating it.
 */

import { join } from 'path';
import { homedir } from 'os';
import {
  cachedBinary,
  type Harness,
  type HarnessAddSpec,
  type RestartNotice,
} from './harness.js';
import { CEETRIX_MCP_SERVER_NAME } from './constants.js';
import { writeMcpEntry, hasMcpEntry, removeMcpEntry, fileExists } from './json-mcp-config.js';

/** Identifier in the AgentType union. */
export const OMP_ID = 'omp';

/** Name shown in the wizard and the not-found message. */
const OMP_LABEL = 'omp (Oh My Pi)';

/** Where a user installs it. */
const OMP_HOMEPAGE = 'https://omp.sh';

/** Binary name on PATH. */
const OMP_COMMAND = 'omp';

/**
 * Marker in `omp --version` output.
 *
 * The binary prints `omp/<semver>`; the slash is included so a binary that
 * merely mentions "omp" somewhere does not pass.
 */
const OMP_VERSION_MARKER = 'omp/';

/**
 * Fallback paths.
 *
 * `~/.local/bin` first because that is the omp installer's own default
 * (`INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"`), not a guess.
 */
const COMMON_OMP_PATHS = [
  `${process.env.HOME}/.local/bin/omp`,
  '/opt/homebrew/bin/omp',
  '/usr/local/bin/omp',
];

/** Root of omp's user state. */
const OMP_HOME_DIR = '.omp';

/** Agent directory under the omp root, confirmed by `omp config path`. */
const OMP_AGENT_DIR = 'agent';

/** Directory holding named profiles, each with its own agent directory. */
const OMP_PROFILES_DIR = 'profiles';

/** MCP config filename. omp reads `.mcp.json` too but writes this one. */
const OMP_MCP_FILE = 'mcp.json';

/** Top-level key holding the server map. */
const OMP_CONTAINER_KEY = 'mcpServers';

/*
 * No $schema reference is written.
 *
 * omp writes one itself into files it manages, and it is only editor
 * convenience. Ceetrix cannot distinguish a $schema it wrote from one the
 * person wrote, so any rule for removing it again would be a guess — and a key
 * that cannot be cleanly taken back leaves removal unable to restore the file,
 * which is what task 547.13 was raised for. A key we will not remove does not
 * go into someone else's file.
 */

const binary = cachedBinary({
  command: OMP_COMMAND,
  fallbackPaths: COMMON_OMP_PATHS,
  probeArgs: '--version',
  marker: OMP_VERSION_MARKER,
});

/**
 * Resolve the active profile name.
 *
 * omp isolates user-level MCP config per named profile, and the profile can be
 * selected by either of two environment variables — `PI_PROFILE` is honoured
 * for compatibility with pi, which omp was forked from.
 *
 * @returns The profile name, or null for the default profile
 */
function activeProfile(): string | null {
  return process.env.OMP_PROFILE || process.env.PI_PROFILE || null;
}

/**
 * Full path to the MCP config file for the active profile.
 *
 * @returns Absolute path to omp's user-level mcp.json
 */
export function getConfigPath(): string {
  const root = join(homedir(), OMP_HOME_DIR);
  const profile = activeProfile();

  if (profile) {
    return join(root, OMP_PROFILES_DIR, profile, OMP_AGENT_DIR, OMP_MCP_FILE);
  }

  return join(root, OMP_AGENT_DIR, OMP_MCP_FILE);
}

/**
 * Build the server entry.
 *
 * `type: "http"` is required for a remote server; omitting it makes omp treat
 * the entry as stdio and fail with `stdio server requires "command" field`.
 *
 * @param spec - API key and MCP endpoint
 * @returns The entry to store under the server name
 */
function buildEntry(spec: HarnessAddSpec): Record<string, unknown> {
  return {
    type: 'http',
    url: spec.url,
    headers: { 'X-API-Key': spec.apiKey },
  };
}

export const harness = {
  id: OMP_ID,
  label: OMP_LABEL,
  homepage: OMP_HOMEPAGE,

  detect: async () => (await binary.get()) !== '',

  isConfigured: async () =>
    hasMcpEntry({
      filePath: getConfigPath(),
      containerKey: OMP_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
    }),

  add: async (spec: HarnessAddSpec) => {
    await writeMcpEntry({
      filePath: getConfigPath(),
      containerKey: OMP_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
      entry: buildEntry(spec),
    });
  },

  remove: async () => {
    await removeMcpEntry({
      filePath: getConfigPath(),
      containerKey: OMP_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
    });
  },

  restartNotice: (): RestartNotice => ({
    title: `Restart ${OMP_LABEL} to activate Ceetrix`,
    lines: [
      'Quit and reopen omp, then describe a feature you',
      'want to build and ask it to "create a story for it".',
      '',
      'To check the server inside omp, run /mcp list.',
      'omp has no non-interactive mcp command.',
    ],
  }),

  diagnose: async () => {
    const path = await binary.get();
    const configPath = getConfigPath();
    return [
      `binary: ${path || 'not found'}`,
      `config: ${configPath}${(await fileExists(configPath)) ? '' : ' (absent)'}`,
      `profile: ${activeProfile() ?? 'default'}`,
    ];
  },

  resetCache: () => binary.reset(),
} satisfies Harness;
