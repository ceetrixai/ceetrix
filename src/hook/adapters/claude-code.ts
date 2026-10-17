/**
 * Claude Code adapter (story 510): the four places the hook program meets
 * Claude Code, as data.
 *
 * 1. Event names: Claude Code's hook_event_name to the program's events.
 * 2. Payload fields: the program's fields to Claude Code's payload keys,
 *    checked against the 2.1.302 captures.
 * 3. Decision serialisation: the program's decisions to Claude Code's
 *    hook output JSON.
 * 4. Matchers: which events setup registers, with which tool matcher.
 */

import { resolve } from 'path';
import { detectShellWrites } from '../shell.js';
import type { WriteTarget } from '../types.js';
import type { PreWriteDecision, TurnEndDecision } from '../decide.js';

export type HookEvent = 'session_start' | 'prompt' | 'pre_tool' | 'post_tool' | 'turn_end' | 'session_end';

/** 1. Event names. */
export const CLAUDE_CODE_EVENTS: Record<string, HookEvent> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'pre_tool',
  PostToolUse: 'post_tool',
  Stop: 'turn_end',
  SessionEnd: 'session_end',
};

export interface Payload {
  sessionId: string | null;
  cwd: string | null;
  promptId: string | null;
  toolName: string | null;
  toolInput: Record<string, unknown>;
  toolResponse: unknown;
  stopHookActive: boolean;
  prompt: string | null;
  source: string | null;
  reason: string | null;
}

/** 2. Payload fields. */
export const CLAUDE_CODE_FIELDS: Record<keyof Payload, string> = {
  sessionId: 'session_id',
  cwd: 'cwd',
  promptId: 'prompt_id',
  toolName: 'tool_name',
  toolInput: 'tool_input',
  toolResponse: 'tool_response',
  stopHookActive: 'stop_hook_active',
  prompt: 'prompt',
  source: 'source',
  reason: 'reason',
};

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function readPayload(raw: Record<string, unknown>): Payload {
  const f = CLAUDE_CODE_FIELDS;
  const input = raw[f.toolInput];
  return {
    sessionId: str(raw[f.sessionId]),
    cwd: str(raw[f.cwd]),
    promptId: str(raw[f.promptId]),
    toolName: str(raw[f.toolName]),
    toolInput: input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
    toolResponse: raw[f.toolResponse] ?? null,
    stopHookActive: raw[f.stopHookActive] === true,
    prompt: str(raw[f.prompt]),
    source: str(raw[f.source]),
    reason: str(raw[f.reason]),
  };
}

/** File tools and the tool_input field naming the file each writes. */
export const FILE_TOOL_PATH_FIELDS: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

const SHELL_TOOL = 'Bash';
const SHELL_COMMAND_FIELD = 'command';

/** What a PreToolUse call writes. */
export function writeTargetFor(payload: Payload, homeDir: string): WriteTarget {
  const tool = payload.toolName;
  if (tool === null) return { kind: 'none' };
  const cwd = payload.cwd ?? process.cwd();
  const field = FILE_TOOL_PATH_FIELDS[tool];
  if (field) {
    const p = payload.toolInput[field];
    if (typeof p !== 'string' || p.length === 0) return { kind: 'unknown', reason: `${tool} without ${field}` };
    return { kind: 'paths', paths: [resolve(cwd, p)] };
  }
  if (tool === SHELL_TOOL) {
    const command = payload.toolInput[SHELL_COMMAND_FIELD];
    if (typeof command !== 'string') return { kind: 'unknown', reason: 'Bash without command' };
    return detectShellWrites(command, cwd, homeDir);
  }
  return { kind: 'none' };
}

/** The Ceetrix task tool, as a direct MCP server or a plugin's. */
const CEETRIX_TASK_TOOL = /^(?:mcp__ceetrix__task|mcp__plugin_.*_ceetrix__task)$/;

export function isCeetrixTaskTool(name: string | null): boolean {
  return name !== null && CEETRIX_TASK_TOOL.test(name);
}

/** 3. Decision serialisation. An empty string means "print nothing". */
export const serialise = {
  preWrite(d: PreWriteDecision): string {
    if (d.outcome === 'deny') {
      return JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.message },
      });
    }
    if (d.outcome === 'warn') {
      // No permissionDecision: "allow" would skip the developer's own
      // permission prompt. Context only, so normal permissions still apply.
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: d.message } });
    }
    return '';
  },
  prompt(text: string | null): string {
    if (text === null) return '';
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } });
  },
  turnEnd(d: TurnEndDecision): string {
    if (d.outcome === 'block') return JSON.stringify({ decision: 'block', reason: d.message });
    return '';
  },
};

/** 4. Matchers: every event setup registers, in order. Null: no matcher. */
export const CLAUDE_CODE_MATCHERS: ReadonlyArray<{ event: string; matcher: string | null }> = [
  { event: 'SessionStart', matcher: null },
  { event: 'UserPromptSubmit', matcher: null },
  { event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash' },
  { event: 'PostToolUse', matcher: 'mcp__ceetrix__task|mcp__plugin_.*_ceetrix__task' },
  { event: 'Stop', matcher: null },
  { event: 'SessionEnd', matcher: null },
];
