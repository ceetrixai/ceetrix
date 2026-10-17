/**
 * `ceetrix hooks`: write the repo-resident hook configuration (story 510).
 *
 * - <repo>/.claude/settings.json: Ceetrix's hook entries merged in. Other
 *   keys and the developer's own hook entries are kept. Re-running replaces
 *   only Ceetrix's entries, recognised by a command naming ceetrix-hook.mjs.
 * - <repo>/.ceetrix/hook/ceetrix-hook.mjs: the bundled hook program.
 * - <repo>/.ceetrix/policy.yaml: the default policy, only when absent.
 *
 * Commands use $CLAUDE_PROJECT_DIR, never an absolute path, so the files can
 * be committed. Every entry is a command handler with an explicit timeout;
 * none is an mcp_tool handler.
 */

import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  CEETRIX_DIR,
  HOOK_DIR,
  HOOK_FILE_NAME,
  HOOK_TIMEOUT_SECONDS,
  HOST_CLAUDE_CODE,
  POLICY_FILE,
  GIT_COMMAND_TIMEOUT_MS,
} from './constants.js';
import { CLAUDE_CODE_MATCHERS } from './adapters/claude-code.js';
import { DEFAULT_POLICY_TEXT } from './policy.js';

const CLAUDE_DIR = '.claude';
const SETTINGS_FILE = 'settings.json';
const JSON_INDENT = 2;

interface HookHandler {
  type: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
  [key: string]: unknown;
}

/** The exact command Claude Code runs for one event. */
export function hookCommand(event: string): string {
  return `node "$CLAUDE_PROJECT_DIR/${CEETRIX_DIR}/${HOOK_DIR}/${HOOK_FILE_NAME}" ${HOST_CLAUDE_CODE} ${event}`;
}

function isCeetrixHandler(h: unknown): boolean {
  return !!h && typeof h === 'object' && typeof (h as HookHandler).command === 'string'
    && (h as HookHandler).command!.includes(HOOK_FILE_NAME);
}

/**
 * Merge Ceetrix's hook entries into parsed settings. Pure.
 *
 * @throws When `hooks` exists and is not an object of arrays
 */
export function mergeHookSettings(existing: unknown): Record<string, unknown> {
  if (existing !== undefined && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
    throw new Error('settings.json is not a JSON object');
  }
  const settings: Record<string, unknown> = { ...((existing as Record<string, unknown>) ?? {}) };
  const rawHooks = settings.hooks ?? {};
  if (typeof rawHooks !== 'object' || rawHooks === null || Array.isArray(rawHooks)) {
    throw new Error('settings.json "hooks" is not an object');
  }
  const hooks: Record<string, unknown> = { ...(rawHooks as Record<string, unknown>) };

  // Remove Ceetrix's own handlers everywhere, dropping groups left empty by it.
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`settings.json hooks.${event} is not a list`);
    hooks[event] = groups.flatMap((g: MatcherGroup) => {
      if (!g || !Array.isArray(g.hooks)) return [g];
      const kept = g.hooks.filter((h) => !isCeetrixHandler(h));
      if (kept.length === g.hooks.length) return [g];
      return kept.length > 0 ? [{ ...g, hooks: kept }] : [];
    });
  }

  for (const { event, matcher } of CLAUDE_CODE_MATCHERS) {
    const group: MatcherGroup = {
      ...(matcher === null ? {} : { matcher }),
      hooks: [{ type: 'command', command: hookCommand(event), timeout: HOOK_TIMEOUT_SECONDS }],
    };
    hooks[event] = [...((hooks[event] as MatcherGroup[] | undefined) ?? []), group];
  }

  settings.hooks = hooks;
  return settings;
}

export interface SetupResult {
  settingsPath: string;
  hookPath: string;
  policyPath: string;
  policyCreated: boolean;
  events: string[];
}

/** The bundle sits next to the compiled setup module: dist/hook/. */
function defaultBundlePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), HOOK_FILE_NAME);
}

export async function setupHooks(repoRoot: string, opts: { bundlePath?: string } = {}): Promise<SetupResult> {
  const bundlePath = opts.bundlePath ?? defaultBundlePath();
  if (!existsSync(bundlePath)) {
    throw new Error(`hook program not found at ${bundlePath}; build it with: bun run build`);
  }

  const settingsPath = join(repoRoot, CLAUDE_DIR, SETTINGS_FILE);
  let existing: unknown;
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      throw new Error(`${settingsPath} is not valid JSON; not modified (${(err as Error).message})`);
    }
  }
  const merged = mergeHookSettings(existing);

  const hookDir = join(repoRoot, CEETRIX_DIR, HOOK_DIR);
  const hookPath = join(hookDir, HOOK_FILE_NAME);
  mkdirSync(hookDir, { recursive: true });
  copyFileSync(bundlePath, hookPath);

  const policyPath = join(repoRoot, CEETRIX_DIR, POLICY_FILE);
  const policyCreated = !existsSync(policyPath);
  if (policyCreated) writeFileSync(policyPath, DEFAULT_POLICY_TEXT);

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(merged, null, JSON_INDENT)}\n`);

  return { settingsPath, hookPath, policyPath, policyCreated, events: CLAUDE_CODE_MATCHERS.map((m) => m.event) };
}

/**
 * The `ceetrix hooks` subcommand: set up the git repo containing cwd.
 *
 * @returns Exit status
 */
export async function runHooksCommand(cwd: string = process.cwd()): Promise<number> {
  let repoRoot: string;
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    console.error('✗ Not inside a git repository. Run `ceetrix hooks` from the repository to set up.');
    return 1;
  }
  try {
    const r = await setupHooks(repoRoot);
    console.log(`✓ Hook entries for ${r.events.join(', ')} written to ${r.settingsPath}`);
    console.log(`✓ Hook program copied to ${r.hookPath}`);
    console.log(r.policyCreated ? `✓ Default policy written to ${r.policyPath}` : `  Existing policy kept at ${r.policyPath}`);
    console.log('\nCommit .claude/settings.json and .ceetrix/ so everyone working in this repository gets the hooks.');
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
