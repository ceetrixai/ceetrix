/**
 * OpenCode integration — https://opencode.ai
 *
 * Verified against opencode 1.18.20 on 2026-09-19.
 *
 * Registration is a direct file write rather than a call to `opencode mcp add`,
 * even though that command exists and takes `--url` and `--header KEY=VALUE`.
 * The reason is the other half of the lifecycle: **there is no
 * `opencode mcp remove`**. The subcommands are add, list, auth, logout and
 * debug. Using the CLI to add and a file edit to remove would leave two
 * mechanisms that can disagree, and only one of them testable. One code path
 * makes the round trip verifiable in one place.
 *
 * `opencode mcp list` does exist, so opencode is one of only two new harnesses
 * with a genuine non-interactive verification command.
 */

import { join } from 'path';
import { homedir } from 'os';
import {
  cachedBinary,
  HarnessSkipped,
  type Harness,
  type HarnessAddSpec,
  type RestartNotice,
} from './harness.js';
import { CEETRIX_MCP_SERVER_NAME } from './constants.js';
import { writeMcpEntry, hasMcpEntry, removeMcpEntry, fileExists } from './json-mcp-config.js';

/** Identifier in the AgentType union. */
export const OPENCODE_ID = 'opencode';

/** Name shown in the wizard and the not-found message. */
const OPENCODE_LABEL = 'OpenCode';

/** Where a user installs it. */
const OPENCODE_HOMEPAGE = 'https://opencode.ai';

/** Binary name on PATH. */
const OPENCODE_COMMAND = 'opencode';

/**
 * Marker for the identity probe.
 *
 * `opencode --version` prints a bare semver with no product name, so it cannot
 * establish identity the way Claude Code's and omp's version strings do. The
 * probe reads `--help` instead and looks for the MCP subcommand line, which
 * has the useful property of also proving the capability this module depends
 * on. That is a weaker contract than a version string: help text is not a
 * stable interface.
 */
const OPENCODE_HELP_MARKER = 'opencode mcp';

/** Fallback paths, checked when PATH lookup fails. */
const COMMON_OPENCODE_PATHS = [
  '/opt/homebrew/bin/opencode',
  '/usr/local/bin/opencode',
  `${process.env.HOME}/.opencode/bin/opencode`,
  `${process.env.HOME}/.local/bin/opencode`,
];

/** Config directory under the XDG config root. */
const OPENCODE_CONFIG_DIR = 'opencode';

/** Config filename opencode writes and Ceetrix edits. */
const OPENCODE_CONFIG_FILE = 'opencode.json';

/**
 * Commented variant of the config file.
 *
 * opencode accepts this form. Ceetrix will not touch it: round-tripping it
 * through JSON.parse/stringify silently deletes every comment the user wrote.
 */
const OPENCODE_CONFIG_FILE_JSONC = 'opencode.jsonc';

/** Top-level key holding the server map. Not `mcpServers`, unlike pi and omp. */
const OPENCODE_CONTAINER_KEY = 'mcp';

/** Default XDG config root, used when XDG_CONFIG_HOME is unset. */
const DEFAULT_XDG_CONFIG_DIR = '.config';

const binary = cachedBinary({
  command: OPENCODE_COMMAND,
  fallbackPaths: COMMON_OPENCODE_PATHS,
  probeArgs: '--help',
  marker: OPENCODE_HELP_MARKER,
});

/**
 * The XDG config root opencode reads from.
 *
 * Verified that the binary references XDG_CONFIG_HOME, so honouring it is not
 * an assumption.
 *
 * @returns Absolute path to the config root
 */
function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), DEFAULT_XDG_CONFIG_DIR);
}

/**
 * Path to the JSON config file.
 *
 * @returns Absolute path to opencode.json
 */
export function getConfigPath(): string {
  return join(xdgConfigHome(), OPENCODE_CONFIG_DIR, OPENCODE_CONFIG_FILE);
}

/**
 * Path to the commented config file, which Ceetrix refuses to edit.
 *
 * @returns Absolute path to opencode.jsonc
 */
export function getJsoncConfigPath(): string {
  return join(xdgConfigHome(), OPENCODE_CONFIG_DIR, OPENCODE_CONFIG_FILE_JSONC);
}

/**
 * Refuse to proceed when the user keeps their config in the commented form.
 *
 * This is deliberately a refusal and not a silent conversion. Writing JSON back
 * over a .jsonc file would strip every comment without telling anyone, which is
 * the kind of quiet data loss a fallback produces.
 *
 * @throws Error naming the file and what to do instead
 */
async function refuseIfJsonc(): Promise<void> {
  const jsoncPath = getJsoncConfigPath();

  if (await fileExists(jsoncPath)) {
    throw new HarnessSkipped(
      `${jsoncPath} exists, and writing JSON back over it would delete its comments`,
      `Add this to the "mcp" block in ${jsoncPath} yourself:\n` +
        `  "${CEETRIX_MCP_SERVER_NAME}": { "type": "remote", "url": "<url>", ` +
        `"headers": { "X-API-Key": "<key>" }, "enabled": true }`
    );
  }
}

/**
 * Build the server entry.
 *
 * `type: "remote"` is opencode's name for a server reached over HTTP; the
 * local/stdio form uses `type: "local"` with a `command` array instead.
 *
 * @param spec - API key and MCP endpoint
 * @returns The entry to store under the server name
 */
function buildEntry(spec: HarnessAddSpec): Record<string, unknown> {
  return {
    type: 'remote',
    url: spec.url,
    headers: { 'X-API-Key': spec.apiKey },
    enabled: true,
  };
}

export const harness = {
  id: OPENCODE_ID,
  label: OPENCODE_LABEL,
  homepage: OPENCODE_HOMEPAGE,

  detect: async () => (await binary.get()) !== '',

  isConfigured: async () =>
    hasMcpEntry({
      filePath: getConfigPath(),
      containerKey: OPENCODE_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
    }),

  add: async (spec: HarnessAddSpec) => {
    await refuseIfJsonc();
    await writeMcpEntry({
      filePath: getConfigPath(),
      containerKey: OPENCODE_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
      entry: buildEntry(spec),
    });
  },

  remove: async () => {
    await refuseIfJsonc();
    await removeMcpEntry({
      filePath: getConfigPath(),
      containerKey: OPENCODE_CONTAINER_KEY,
      serverName: CEETRIX_MCP_SERVER_NAME,
    });
  },

  restartNotice: (): RestartNotice => ({
    title: `Restart ${OPENCODE_LABEL} to activate Ceetrix`,
    lines: [
      'Quit and reopen OpenCode, then describe a feature you',
      'want to build and ask it to "create a story for it".',
      '',
      'To confirm the server is connected, run:',
      '  opencode mcp list',
    ],
  }),

  diagnose: async () => {
    const path = await binary.get();
    const configPath = getConfigPath();
    const lines = [
      `binary: ${path || 'not found'}`,
      `config: ${configPath}${(await fileExists(configPath)) ? '' : ' (absent)'}`,
    ];

    if (await fileExists(getJsoncConfigPath())) {
      lines.push(`jsonc: ${getJsoncConfigPath()} present — Ceetrix will refuse to edit it`);
    }

    return lines;
  },

  resetCache: () => binary.reset(),
} satisfies Harness;
