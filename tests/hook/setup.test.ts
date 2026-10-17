/**
 * Setup output validity: the repo-resident Claude Code settings, the copied
 * hook program and the default policy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setupHooks, mergeHookSettings, hookCommand } from '../../src/hook/setup.js';
import { parsePolicy } from '../../src/hook/policy.js';
import { HOOK_TIMEOUT_MS } from '../../src/hook/constants.js';

const MS_PER_SECOND = 1000;
const CLAUDE_CODE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];

let repo: string;
let bundle: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ceetrix-setup-'));
  const dist = mkdtempSync(join(tmpdir(), 'ceetrix-bundle-'));
  bundle = join(dist, 'ceetrix-hook.mjs');
  writeFileSync(bundle, '// bundled hook\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function settings(): Record<string, any> {
  return JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
}

function allEntries(s: Record<string, any>): Array<Record<string, any>> {
  return Object.values(s.hooks as Record<string, any[]>).flatMap((groups) => groups.flatMap((g) => g.hooks));
}

describe('setupHooks', () => {
  it('writes settings that parse and register all six Claude Code events, and only those', async () => {
    await setupHooks(repo, { bundlePath: bundle });
    const s = settings();
    expect(Object.keys(s.hooks).sort()).toEqual([...CLAUDE_CODE_EVENTS].sort());
  });

  // Task 510.5: setup says which hosts it skipped rather than guessing.
  it('reports Codex CLI and Gemini CLI as skipped, and writes nothing for them', async () => {
    const r = await setupHooks(repo, { bundlePath: bundle });
    expect(r.skippedHosts).toEqual(['Codex CLI', 'Gemini CLI']);
    expect(existsSync(join(repo, '.codex'))).toBe(false);
    expect(existsSync(join(repo, '.gemini'))).toBe(false);
  });

  it('every entry is a command with an explicit timeout in seconds', async () => {
    await setupHooks(repo, { bundlePath: bundle });
    for (const entry of allEntries(settings())) {
      expect(entry.type).toBe('command');
      expect(entry.timeout).toBe(HOOK_TIMEOUT_MS / MS_PER_SECOND);
    }
  });

  it('uses the exact command form for each event, with the event name', async () => {
    await setupHooks(repo, { bundlePath: bundle });
    const s = settings();
    for (const event of CLAUDE_CODE_EVENTS) {
      expect(s.hooks[event][0].hooks[0].command).toBe(
        `node "$CLAUDE_PROJECT_DIR/.ceetrix/hook/ceetrix-hook.mjs" claude-code ${event}`,
      );
    }
    expect(hookCommand('Stop')).toBe('node "$CLAUDE_PROJECT_DIR/.ceetrix/hook/ceetrix-hook.mjs" claude-code Stop');
  });

  it('matchers per the contract; events without a matcher have no matcher key', async () => {
    await setupHooks(repo, { bundlePath: bundle });
    const s = settings();
    expect(s.hooks.PreToolUse[0].matcher).toBe('Write|Edit|MultiEdit|NotebookEdit|Bash');
    expect(s.hooks.PostToolUse[0].matcher).toBe('mcp__ceetrix__task|mcp__plugin_.*_ceetrix__task');
    for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
      expect('matcher' in s.hooks[event][0]).toBe(false);
    }
  });

  it('contains no absolute path anywhere', async () => {
    await setupHooks(repo, { bundlePath: bundle });
    const raw = readFileSync(join(repo, '.claude', 'settings.json'), 'utf8');
    expect(raw).not.toContain(repo);
    expect(raw).not.toMatch(/"\/|\s\/[A-Za-z]/);
  });

  it('has no mcp_tool handler (N-18)', async () => {
    await setupHooks(repo, { bundlePath: bundle });
    for (const entry of allEntries(settings())) {
      expect(entry.type).not.toBe('mcp_tool');
    }
    expect(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8')).not.toContain('mcp_tool');
  });

  it('merge preserves an existing user hook entry and other keys', async () => {
    mkdirSync(join(repo, '.claude'));
    const userEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] };
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [userEntry], Notification: [{ hooks: [{ type: 'command', command: 'say hi' }] }] } }),
    );
    await setupHooks(repo, { bundlePath: bundle });
    const s = settings();
    expect(s.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(s.hooks.PreToolUse).toContainEqual(userEntry);
    expect(s.hooks.Notification).toEqual([{ hooks: [{ type: 'command', command: 'say hi' }] }]);
    expect(s.hooks.PreToolUse.length).toBe(2);
  });

  it('re-running is idempotent and replaces only Ceetrix entries', async () => {
    mkdirSync(join(repo, '.claude'));
    const userEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] };
    writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [userEntry] } }));
    await setupHooks(repo, { bundlePath: bundle });
    const first = readFileSync(join(repo, '.claude', 'settings.json'), 'utf8');
    await setupHooks(repo, { bundlePath: bundle });
    const second = readFileSync(join(repo, '.claude', 'settings.json'), 'utf8');
    expect(second).toBe(first);
    expect(settings().hooks.PreToolUse.length).toBe(2);
  });

  it('a Ceetrix entry sharing a group with a user entry is replaced, the user entry kept', () => {
    const merged = mergeHookSettings({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'node old/ceetrix-hook.mjs claude-code Stop' }, { type: 'command', command: 'echo mine' }] }],
      },
    }) as any;
    expect(merged.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'echo mine' }] },
      { hooks: [{ type: 'command', command: hookCommand('Stop'), timeout: HOOK_TIMEOUT_MS / MS_PER_SECOND }] },
    ]);
  });

  it('refuses to overwrite settings that are not valid JSON', async () => {
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'settings.json'), '{ broken');
    await expect(setupHooks(repo, { bundlePath: bundle })).rejects.toThrow(/settings\.json/);
    expect(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8')).toBe('{ broken');
  });

  it('copies the bundled hook into .ceetrix/hook', async () => {
    await setupHooks(repo, { bundlePath: bundle });
    expect(readFileSync(join(repo, '.ceetrix', 'hook', 'ceetrix-hook.mjs'), 'utf8')).toBe('// bundled hook\n');
  });

  it('fails clearly when the bundle has not been built', async () => {
    await expect(setupHooks(repo, { bundlePath: join(repo, 'missing.mjs') })).rejects.toThrow(/missing\.mjs/);
  });

  it('writes the default policy when absent, and leaves an existing one alone', async () => {
    const r1 = await setupHooks(repo, { bundlePath: bundle });
    expect(r1.policyCreated).toBe(true);
    const text = readFileSync(join(repo, '.ceetrix', 'policy.yaml'), 'utf8');
    expect(parsePolicy(text)).toEqual({ forbidden: [], no_project: 'allow_with_warning', error: null });

    writeFileSync(join(repo, '.ceetrix', 'policy.yaml'), 'forbidden: [x]\n');
    const r2 = await setupHooks(repo, { bundlePath: bundle });
    expect(r2.policyCreated).toBe(false);
    expect(readFileSync(join(repo, '.ceetrix', 'policy.yaml'), 'utf8')).toBe('forbidden: [x]\n');
  });

  it('reports the paths it wrote', async () => {
    const r = await setupHooks(repo, { bundlePath: bundle });
    expect(r.settingsPath).toBe(join(repo, '.claude', 'settings.json'));
    expect(r.hookPath).toBe(join(repo, '.ceetrix', 'hook', 'ceetrix-hook.mjs'));
    expect(r.policyPath).toBe(join(repo, '.ceetrix', 'policy.yaml'));
    expect(existsSync(r.hookPath)).toBe(true);
  });
});
