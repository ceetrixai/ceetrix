/**
 * The Claude Code adapter's four maps, checked against the real captures.
 */
import { describe, it, expect } from 'vitest';
import {
  CLAUDE_CODE_EVENTS,
  CLAUDE_CODE_FIELDS,
  CLAUDE_CODE_MATCHERS,
  readPayload,
  serialise,
  writeTargetFor,
  isCeetrixTaskTool,
} from '../../src/hook/adapters/claude-code.js';
import { fixture, FIXTURE_REPO, type FixtureName } from './helpers.js';

const BY_EVENT: Array<[FixtureName, string]> = [
  ['session-start', 'session_start'],
  ['user-prompt-submit', 'prompt'],
  ['pre-tool-use-write', 'pre_tool'],
  ['post-tool-use-ceetrix-task-get', 'post_tool'],
  ['stop', 'turn_end'],
  ['session-end', 'session_end'],
];

describe('event map', () => {
  it.each(BY_EVENT)('%s maps its hook_event_name to %s', (name, internal) => {
    const payload = fixture(name);
    expect(CLAUDE_CODE_EVENTS[payload.hook_event_name as string]).toBe(internal);
  });

  it('names exactly the six Claude Code events', () => {
    expect(Object.keys(CLAUDE_CODE_EVENTS).sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'],
    );
  });
});

describe('payload field map', () => {
  it('every mapped field name occurs in at least one capture', () => {
    const all = BY_EVENT.map(([n]) => fixture(n));
    for (const host of Object.values(CLAUDE_CODE_FIELDS)) {
      expect(all.some((p) => host in p), `${host} not in any capture`).toBe(true);
    }
  });

  it('reads the captured fields', () => {
    const pre = readPayload(fixture('pre-tool-use-write'));
    expect(pre.sessionId).toBe('c6093c60-3fe5-4fcb-850f-e45d05dcc4ab');
    expect(pre.cwd).toBe(FIXTURE_REPO);
    expect(pre.promptId).toBe('0a93645d-f000-4c38-9a99-651b232b687f');
    expect(pre.toolName).toBe('Write');
    expect(pre.toolInput).toEqual({ file_path: `${FIXTURE_REPO}/b.txt`, content: 'x' });

    const stop = readPayload(fixture('stop'));
    expect(stop.stopHookActive).toBe(false);

    const start = readPayload(fixture('session-start'));
    expect(start.source).toBe('startup');
    expect(start.promptId).toBeNull();

    const end = readPayload(fixture('session-end'));
    expect(end.reason).toBe('other');

    const prompt = readPayload(fixture('user-prompt-submit'));
    expect(prompt.prompt).toMatch(/^Call the mcp__ceetrix__task tool/);
  });

  it('a payload missing fields reads as nulls, never throws', () => {
    const p = readPayload({});
    expect(p.sessionId).toBeNull();
    expect(p.toolInput).toEqual({});
    expect(p.stopHookActive).toBe(false);
  });
});

describe('write targets', () => {
  it('Write names tool_input.file_path', () => {
    expect(writeTargetFor(readPayload(fixture('pre-tool-use-write')), '/home/dev')).toEqual({
      kind: 'paths',
      paths: [`${FIXTURE_REPO}/b.txt`],
    });
  });

  it('Edit and MultiEdit name file_path; NotebookEdit names notebook_path', () => {
    const base = fixture('pre-tool-use-write');
    for (const tool of ['Edit', 'MultiEdit']) {
      expect(writeTargetFor(readPayload({ ...base, tool_name: tool, tool_input: { file_path: 'a.ts' } }), '/home/dev')).toEqual({ kind: 'paths', paths: [`${FIXTURE_REPO}/a.ts`] });
    }
    expect(writeTargetFor(readPayload({ ...base, tool_name: 'NotebookEdit', tool_input: { notebook_path: '/home/dev/repo/n.ipynb' } }), '/home/dev')).toEqual({ kind: 'paths', paths: [`${FIXTURE_REPO}/n.ipynb`] });
  });

  it('a file tool without its path field is an unknown target', () => {
    const base = fixture('pre-tool-use-write');
    expect(writeTargetFor(readPayload({ ...base, tool_input: {} }), '/home/dev').kind).toBe('unknown');
  });

  it('Bash goes through shell detection', () => {
    const base = fixture('pre-tool-use-write');
    expect(writeTargetFor(readPayload({ ...base, tool_name: 'Bash', tool_input: { command: 'echo x > c.txt' } }), '/home/dev')).toEqual({ kind: 'paths', paths: [`${FIXTURE_REPO}/c.txt`] });
  });

  it('a tool that is not a write tool writes nothing', () => {
    expect(writeTargetFor(readPayload(fixture('pre-tool-use-tool-search')), '/home/dev')).toEqual({ kind: 'none' });
  });
});

describe('Ceetrix task tool names', () => {
  it('matches the captured MCP tool name and the plugin form', () => {
    expect(isCeetrixTaskTool(readPayload(fixture('post-tool-use-ceetrix-task-get')).toolName)).toBe(true);
    expect(isCeetrixTaskTool('mcp__plugin_ceetrix_ceetrix__task')).toBe(true);
    expect(isCeetrixTaskTool('mcp__ceetrix__story')).toBe(false);
    expect(isCeetrixTaskTool('ToolSearch')).toBe(false);
  });
});

describe('decision serialisation', () => {
  it('deny', () => {
    expect(JSON.parse(serialise.preWrite({ outcome: 'deny', rule: 'no_task', message: 'm' }))).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'm' },
    });
  });

  it('warn adds context only, no permissionDecision, so normal permissions still apply', () => {
    expect(JSON.parse(serialise.preWrite({ outcome: 'warn', rule: 'no_task', message: 'm' }))).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'm' },
    });
  });

  it('allow outputs nothing', () => {
    expect(serialise.preWrite({ outcome: 'allow' })).toBe('');
    expect(serialise.preWrite({ outcome: 'allow', degraded: 'cache_missing' })).toBe('');
  });

  it('prompt context', () => {
    expect(JSON.parse(serialise.prompt('t'))).toEqual({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 't' },
    });
    expect(serialise.prompt(null)).toBe('');
  });

  it('turn end block', () => {
    expect(JSON.parse(serialise.turnEnd({ outcome: 'block', message: 'r', promptId: 'p' }))).toEqual({ decision: 'block', reason: 'r' });
    expect(serialise.turnEnd({ outcome: 'allow' })).toBe('');
  });
});

describe('matcher list', () => {
  it('registers all six events with the contract matchers', () => {
    expect(CLAUDE_CODE_MATCHERS).toEqual([
      { event: 'SessionStart', matcher: null },
      { event: 'UserPromptSubmit', matcher: null },
      { event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash' },
      { event: 'PostToolUse', matcher: 'mcp__ceetrix__task|mcp__plugin_.*_ceetrix__task' },
      { event: 'Stop', matcher: null },
      { event: 'SessionEnd', matcher: null },
    ]);
  });

  it('the PostToolUse matcher matches the captured tool name', () => {
    const post = CLAUDE_CODE_MATCHERS.find((m) => m.event === 'PostToolUse')!;
    expect(new RegExp(`^(?:${post.matcher})$`).test(readPayload(fixture('post-tool-use-ceetrix-task-get')).toolName!)).toBe(true);
  });

  it('the PreToolUse matcher matches the captured Write and not ToolSearch', () => {
    const pre = new RegExp(`^(?:${CLAUDE_CODE_MATCHERS.find((m) => m.event === 'PreToolUse')!.matcher})$`);
    expect(pre.test('Write')).toBe(true);
    expect(pre.test('ToolSearch')).toBe(false);
  });
});
