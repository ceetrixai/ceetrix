/**
 * The hook program's decisions (story 510). No I/O: callers supply the cache,
 * the write target and, for turn end, a function that asks the server.
 *
 * Pre-write order: (1) strictness none allows silently; (2) no cache or an
 * unregistered session allows, recorded as degraded (except the policy's
 * no_project setting for a repo with no project); then a malformed policy,
 * an unknown target, and per path: (3) the repo's .ceetrix directory,
 * (4) no binding, (5) task or repo forbidden globs, (6) outside expected
 * scope (empty or never-fetched scope is unrestricted); (7) allow.
 * Enforce denies, advise warns with the same text.
 */

import { relative, isAbsolute, sep } from 'path';
import { firstMatch } from './glob.js';
import { renderWording, type WordingKey, type WordingVars } from './wording.js';
import { CEETRIX_DIR } from './constants.js';
import type { SessionCache, WriteTarget, Logger } from './types.js';

export type PreWriteRule =
  | 'ceetrix_dir'
  | 'no_task'
  | 'forbidden'
  | 'outside_scope'
  | 'unknown_target'
  | 'policy_invalid'
  | 'no_project'
  | 'internal_error';

export type PreWriteDecision =
  | { outcome: 'allow'; degraded?: string }
  | { outcome: 'deny' | 'warn'; rule: PreWriteRule; message: string };

export interface PreWriteInput {
  cache: SessionCache | null;
  target: WriteTarget;
  log: Logger;
}

/** Degraded reasons meaning "this repo has no Ceetrix project", where the policy's no_project applies. */
const NO_PROJECT_REASONS = new Set(['no_remote', 'no_project']);

/** Rendered when a list is empty. LLM-bound literals the server does not serve. */
const EMPTY_SCOPE_TEXT = '(unrestricted)';
const EMPTY_FORBIDDEN_TEXT = '(none)';
const LIST_SEPARATOR = ', ';
const STRICTNESS_TAG = /^\[[a-z]+\]\s*/;

function nextTaskLine(cache: SessionCache, log: Logger): string {
  const t = cache.next_task;
  if (!t) return renderWording(cache.wording, 'hook.next_task_none', {}, log);
  return renderWording(
    cache.wording,
    'hook.next_task_line',
    {
      story_id: t.story_id,
      seq: t.seq,
      title: t.title,
      capability_clause: t.capability
        ? renderWording(cache.wording, 'hook.next_task_capability', { capability: t.capability }, log)
        : '',
    },
    log,
  );
}

function refuse(
  cache: SessionCache,
  rule: PreWriteRule,
  key: WordingKey,
  vars: WordingVars,
  log: Logger,
): PreWriteDecision {
  const message = renderWording(cache.wording, key, { strictness: cache.strictness ?? '', ...vars }, log);
  if (cache.strictness === 'enforce') return { outcome: 'deny', rule, message };
  const prefix = renderWording(cache.wording, 'hook.warn.prefix', {}, log);
  return { outcome: 'warn', rule, message: `${prefix}${message.replace(STRICTNESS_TAG, '')}` };
}

/**
 * Task 510.1: the per-write decision itself failed. With a registered cache
 * the cached strictness decides (enforce denies, advise warns, none allows);
 * without one nothing is known, so the write is allowed and recorded degraded.
 */
export function decideInternalFailure(cache: SessionCache | null, error: string, log: Logger): PreWriteDecision {
  if (!cache || !cache.registered || cache.strictness === 'none' || cache.strictness === null) {
    return { outcome: 'allow', degraded: `internal_error: ${error}` };
  }
  return refuse(cache, 'internal_error', 'hook.deny.internal_error', { error }, log);
}

/** Repo-relative path, or null when the path is outside the repo. */
function repoRelative(repoRoot: string, path: string): string | null {
  const rel = relative(repoRoot, path);
  if (rel === '' ) return '';
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function isCeetrixDir(rel: string): boolean {
  return rel === CEETRIX_DIR || rel.startsWith(`${CEETRIX_DIR}/`);
}

export function decidePreWrite({ cache, target, log }: PreWriteInput): PreWriteDecision {
  if (target.kind === 'none') return { outcome: 'allow' };
  if (!cache) return { outcome: 'allow', degraded: 'cache_missing' };

  if (!cache.registered) {
    const reason = cache.degraded_reason ?? 'unregistered';
    if (NO_PROJECT_REASONS.has(reason) && !cache.policy_error) {
      if (cache.no_project === 'deny') {
        return { outcome: 'deny', rule: 'no_project', message: renderWording(cache.wording, 'hook.deny.no_project', {}, log) };
      }
      return { outcome: 'warn', rule: 'no_project', message: renderWording(cache.wording, 'hook.warn.no_project', {}, log) };
    }
    return { outcome: 'allow', degraded: reason };
  }

  if (cache.strictness === 'none' || cache.strictness === null) return { outcome: 'allow' };

  if (cache.policy_error) {
    return refuse(cache, 'policy_invalid', 'hook.deny.policy_invalid', { error: cache.policy_error }, log);
  }

  if (target.kind === 'unknown') return refuse(cache, 'unknown_target', 'hook.deny.unknown_target', {}, log);

  const binding = cache.binding;
  for (const path of target.paths) {
    const rel = repoRelative(cache.repo_root, path);
    if (rel === null) continue;

    if (isCeetrixDir(rel)) return refuse(cache, 'ceetrix_dir', 'hook.deny.ceetrix_dir', { path: rel }, log);

    if (!binding) {
      return refuse(cache, 'no_task', 'hook.deny.no_task', { path: rel, next_task_line: nextTaskLine(cache, log) }, log);
    }

    const pattern = firstMatch(binding.forbidden, rel) ?? firstMatch(cache.forbidden_globs, rel);
    if (pattern !== null) {
      return refuse(cache, 'forbidden', 'hook.deny.forbidden', { path: rel, story_id: binding.story_id, seq: binding.seq, pattern }, log);
    }

    const unrestricted = binding.retry || binding.expected_scope.length === 0;
    if (!unrestricted && firstMatch(binding.expected_scope, rel) === null) {
      return refuse(
        cache,
        'outside_scope',
        'hook.deny.outside_scope',
        { path: rel, story_id: binding.story_id, seq: binding.seq, expected_scope: binding.expected_scope.join(LIST_SEPARATOR) },
        log,
      );
    }
  }

  return { outcome: 'allow' };
}

/**
 * Context for the agent when the developer submits a prompt, or null for none.
 */
export function decidePrompt(cache: SessionCache | null, log: Logger): string | null {
  if (!cache || !cache.registered || cache.strictness === null) {
    return renderWording(cache?.wording, 'hook.prompt.settings_unknown', {}, log);
  }
  if (cache.strictness === 'none') return null;

  let text: string;
  const b = cache.binding;
  if (b) {
    const forbidden = [...b.forbidden, ...cache.forbidden_globs.filter((g) => !b.forbidden.includes(g))];
    text = renderWording(
      cache.wording,
      'hook.prompt.bound',
      {
        story_id: b.story_id,
        seq: b.seq,
        title: b.title,
        body: b.body,
        expected_scope: b.expected_scope.length > 0 ? b.expected_scope.join(LIST_SEPARATOR) : EMPTY_SCOPE_TEXT,
        forbidden: forbidden.length > 0 ? forbidden.join(LIST_SEPARATOR) : EMPTY_FORBIDDEN_TEXT,
      },
      log,
    );
  } else {
    const key: WordingKey = cache.strictness === 'enforce' ? 'hook.prompt.unbound_enforce' : 'hook.prompt.unbound_advise';
    text = renderWording(cache.wording, key, { next_task_line: nextTaskLine(cache, log) }, log);
  }

  if (cache.stale) text = `${text}\n${renderWording(cache.wording, 'hook.prompt.stale', {}, log)}`;
  return text;
}

export type TaskStatusResult = { kind: 'status'; status: string } | { kind: 'unreachable' };

export interface TurnEndInput {
  cache: SessionCache | null;
  stopHookActive: boolean;
  promptId: string | null;
  fetchStatus: () => Promise<TaskStatusResult>;
  log: Logger;
}

export type TurnEndDecision =
  | { outcome: 'allow'; clearBinding?: true }
  | { outcome: 'block'; message: string; promptId: string | null };

const DONE_STATUS = 'done';

export async function decideTurnEnd(input: TurnEndInput): Promise<TurnEndDecision> {
  const { cache, stopHookActive, promptId, fetchStatus, log } = input;
  if (!cache || !cache.registered || cache.strictness === 'none' || cache.strictness === null) return { outcome: 'allow' };
  const b = cache.binding;
  if (!b) return { outcome: 'allow' };
  if (stopHookActive) return { outcome: 'allow' };
  if (promptId !== null && cache.held_turn_prompt_id === promptId) return { outcome: 'allow' };

  const status = await fetchStatus();
  if (status.kind === 'unreachable') {
    log(`ceetrix-hook: turn end not checked: server unreachable for task ${b.story_id}.${b.seq}`);
    return { outcome: 'allow' };
  }
  if (status.status === DONE_STATUS) return { outcome: 'allow', clearBinding: true };
  return {
    outcome: 'block',
    promptId,
    message: renderWording(cache.wording, 'hook.hold.turn_end', { story_id: b.story_id, seq: b.seq, title: b.title }, log),
  };
}

export type PostToolDecision =
  | { kind: 'bind'; story_id: string; seq: number }
  | { kind: 'unbind'; story_id: string; seq: number }
  | { kind: 'ignore' };

const IN_PROGRESS_STATUS = 'in-progress';

/**
 * What a completed Ceetrix task tool call means for the binding.
 */
export function decidePostTool(cache: SessionCache | null, toolInput: Record<string, unknown>): PostToolDecision {
  if (!cache || !cache.registered || cache.strictness === 'none' || cache.strictness === null) return { kind: 'ignore' };
  const action = toolInput.action;
  const storyId = typeof toolInput.story_id === 'string' ? toolInput.story_id : null;
  const seq = typeof toolInput.seq === 'number' ? toolInput.seq : null;
  const b = cache.binding;
  const isBound = (s: string | null, n: number | null) => b !== null && s === b.story_id && n === b.seq;

  if (action === 'update' && storyId !== null && seq !== null) {
    if (toolInput.status === IN_PROGRESS_STATUS) return { kind: 'bind', story_id: storyId, seq };
    if (toolInput.status === DONE_STATUS && isBound(storyId, seq)) return { kind: 'unbind', story_id: storyId, seq };
    return { kind: 'ignore' };
  }
  if (action === 'complete' && isBound(storyId, seq)) return { kind: 'unbind', story_id: storyId!, seq: seq! };
  if (action === 'complete_bulk' && b && storyId === b.story_id && Array.isArray(toolInput.tasks)) {
    const hit = (toolInput.tasks as Array<{ seq?: unknown }>).some((t) => t && t.seq === b.seq);
    if (hit) return { kind: 'unbind', story_id: b.story_id, seq: b.seq };
  }
  return { kind: 'ignore' };
}
