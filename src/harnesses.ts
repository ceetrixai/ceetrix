/**
 * The registry: the one place the set of supported coding agents is written.
 *
 * Before this existed, the list was a two-member union in prompts.ts and was
 * re-enumerated by hand in a switch, three separate parallel fan-outs, and two
 * diagnostic blocks. Two of those, the switch and the diagnostics, failed
 * silently when a harness was missed: they compiled and simply did nothing for
 * it. Everything now iterates HARNESSES, and AgentType is derived from the
 * array rather than declared beside it, so a harness in the list that is not
 * wired everywhere is a type error.
 *
 * Claude Code and Codex are adapted here rather than inside their own modules.
 * Those two predate the contract and keep their original internal signatures —
 * one takes only a credential and re-derives the endpoint, the other takes
 * both — which is exactly the divergence the contract exists to hide from
 * callers. Their unit tests are untouched by the conversion, which is what
 * makes them a usable regression net for it.
 */

import { join } from 'path';
import { homedir } from 'os';
import { readFile } from 'fs/promises';
import which from 'which';
import {
  runHarnessCommand,
  type Harness,
  type HarnessAddSpec,
  type RestartNotice,
} from './harness.js';
import {
  CEETRIX_MCP_SERVER_NAME,
  CODEX_CONFIG_DIR,
  CODEX_CONFIG_FILE,
} from './constants.js';
import {
  checkClaudeCli,
  checkExistingConfig as claudeIsConfigured,
  addConfig as claudeAdd,
  removeConfig as claudeRemove,
  resetCache as claudeResetCache,
} from './claude.js';
import {
  isCodexAvailable,
  checkExistingConfig as codexIsConfigured,
  addConfig as codexAdd,
  removeConfig as codexRemove,
  resetCache as codexResetCache,
} from './codex.js';
import { harness as ompHarness } from './omp.js';
/**
 * Report where a command resolves on PATH, for the diagnostic report.
 *
 * Detection itself answers only yes or no; troubleshooting needs the path,
 * because the most common failure this report exists to explain is a stale
 * binary of the right name shadowing the real one.
 *
 * @param command - Command name to look up
 * @returns The resolved path, or a readable note when absent
 */
async function locate(command: string): Promise<string> {
  try {
    return await which(command);
  } catch {
    return 'not on PATH';
  }
}

/** Identifier for Claude Code. */
const CLAUDE_ID = 'claude';

/** Identifier for the OpenAI Codex CLI. */
const CODEX_ID = 'codex';

/** Shared closing line for the restart notices, which all say the same thing. */
const TRY_IT_LINES = [
  'then describe a feature you want to build and ask it',
  'to "create a story for it".',
];

const claudeHarness = {
  id: CLAUDE_ID,
  label: 'Claude Code',
  homepage: 'https://docs.anthropic.com/en/docs/claude-code',

  detect: () => checkClaudeCli(),
  isConfigured: () => claudeIsConfigured(),

  // Takes only the credential: this module resolves the endpoint itself. The
  // spec's url is therefore unused here, which is pre-existing behaviour and
  // is asserted by flow.test.ts.
  add: (spec: HarnessAddSpec) => claudeAdd(spec.apiKey),
  remove: () => claudeRemove(),

  restartNotice: (): RestartNotice => ({
    title: 'Restart Claude Code to activate Ceetrix',
    lines: [
      'Claude Code does not auto-detect new MCP servers.',
      'Quit and reopen Claude Code,',
      ...TRY_IT_LINES,
      '',
      'To confirm, run:  claude mcp list',
    ],
  }),

  diagnose: async () => {
    const lines = [`binary: ${await locate('claude')}`];
    lines.push(`detected: ${(await checkClaudeCli()) ? 'yes' : 'no'}`);
    try {
      const stdout = await runHarnessCommand('claude mcp list');
      lines.push(
        `ceetrix entry: ${stdout.includes(`${CEETRIX_MCP_SERVER_NAME}:`) ? 'configured' : 'not configured'}`
      );
    } catch {
      lines.push('ceetrix entry: unable to check (claude mcp list failed)');
    }
    return lines;
  },

  resetCache: () => claudeResetCache(),
} satisfies Harness;

const codexHarness = {
  id: CODEX_ID,
  label: 'OpenAI Codex CLI',
  homepage: 'https://github.com/openai/codex',

  detect: () => isCodexAvailable(),
  isConfigured: () => codexIsConfigured(),
  add: (spec: HarnessAddSpec) => codexAdd(spec.apiKey, spec.url),
  remove: () => codexRemove(),

  restartNotice: (): RestartNotice => ({
    title: 'Restart Codex CLI to activate Ceetrix',
    lines: ['Quit and reopen Codex,', ...TRY_IT_LINES],
  }),

  diagnose: async () => {
    const configPath = join(homedir(), CODEX_CONFIG_DIR, CODEX_CONFIG_FILE);
    const lines = [
      `binary: ${await locate('codex')}`,
      `detected: ${(await isCodexAvailable()) ? 'yes' : 'no'}`,
      `config: ${configPath}`,
    ];
    try {
      const content = await readFile(configPath, 'utf-8');
      lines.push(
        `ceetrix entry: ${content.includes(CEETRIX_MCP_SERVER_NAME) ? 'configured' : 'not configured'}`
      );
    } catch {
      lines.push('ceetrix entry: config file not found');
    }
    return lines;
  },

  resetCache: () => codexResetCache(),
} satisfies Harness;

/**
 * Every supported coding agent, in the order the wizard offers them.
 *
 * Declared `as const` so each entry's `id` keeps its literal type and
 * `AgentType` below resolves to the union of them rather than to `string`.
 */
const HARNESS_LIST = [claudeHarness, codexHarness, ompHarness] as const;

/** Supported agent types, derived from the registry rather than declared beside it. */
export type AgentType = (typeof HARNESS_LIST)[number]['id'];

/** The registry, as the contract rather than as its concrete entries. */
export const HARNESSES: readonly Harness[] = HARNESS_LIST;

/**
 * Look one harness up by identifier.
 *
 * @param id - The harness identifier
 * @returns The harness, or undefined when nothing matches
 */
export function getHarness(id: AgentType): Harness | undefined {
  return HARNESSES.find((harness) => harness.id === id);
}
