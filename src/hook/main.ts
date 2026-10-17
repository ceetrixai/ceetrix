/**
 * Ceetrix hook program entry (story 510).
 *
 *   node ceetrix-hook.mjs <host> <event>   (payload JSON on stdin)
 *
 * Writes the host's hook output to stdout, or nothing, and always exits 0:
 * decisions are expressed in JSON, never in the exit status. A failure of the
 * program itself allows the action and is logged to stderr (the gate fails
 * open on Ceetrix's own failure).
 *
 * The per-write path (PreToolUse) reads the session cache and nothing else:
 * no child process, no network. Git and the server are touched only at
 * session start, prompt (to retry), after a Ceetrix task call, at turn end
 * and at session end.
 */

import { execFileSync } from 'child_process';
import { realpathSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import {
  HOST_CLAUDE_CODE,
  HOOK_VERSION,
  HOOK_CONTRACT,
  GIT_COMMAND_TIMEOUT_MS,
  ROUTE_SESSION,
  ROUTE_BIND,
  ROUTE_TASK,
  ROUTE_SESSION_END,
  SESSION_END_REQUEST_TIMEOUT_MS,
} from './constants.js';
import { stateRoot, readCache, writeCache, deleteCache, sweepCaches } from './cache.js';
import { resolveCredentials, createClient, type HookClient } from './client.js';
import { decidePreWrite, decideInternalFailure, decidePrompt, decideTurnEnd, decidePostTool, type TaskStatusResult, type PreWriteDecision } from './decide.js';
import {
  CLAUDE_CODE_EVENTS,
  readPayload,
  serialise,
  writeTargetFor,
  isCeetrixTaskTool,
  type Payload,
} from './adapters/claude-code.js';
import type { SessionCache, Strictness, Logger, Binding } from './types.js';

export interface HookDeps {
  env: Record<string, string | undefined>;
  homeDir: string;
  now: () => number;
  fetchImpl: typeof fetch;
  /** Run git; stdout trimmed, or null on any failure. */
  git: (args: string[], cwd: string) => string | null;
  /** The repo's policy file text, or null when absent. May throw. */
  readPolicyFile: (repoRoot: string) => string | null;
  log: Logger;
}

const STRICTNESS_VALUES: readonly Strictness[] = ['none', 'advise', 'enforce'];
const IN_PROGRESS = 'in-progress';
const DONE = 'done';

function strictnessOf(v: unknown): Strictness | null {
  return STRICTNESS_VALUES.includes(v as Strictness) ? (v as Strictness) : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

interface Context {
  host: string;
  payload: Payload;
  sessionId: string;
  root: string;
  deps: HookDeps;
}

function clientFor(ctx: Context, repoRoot: string): HookClient | null {
  const creds = resolveCredentials(ctx.deps.env, ctx.deps.homeDir, repoRoot);
  return creds ? createClient({ ...creds, fetchImpl: ctx.deps.fetchImpl }) : null;
}

/** SessionStart logic, also used to retry an unregistered session. */
async function register(ctx: Context, existing: SessionCache | null): Promise<SessionCache> {
  const { deps } = ctx;
  const cwd = ctx.payload.cwd ?? process.cwd();
  const repoRoot = deps.git(['-C', cwd, 'rev-parse', '--show-toplevel'], cwd) ?? cwd;
  const remote = deps.git(['-C', repoRoot, 'remote', 'get-url', 'origin'], repoRoot);

  // Loaded here, not at the top: the YAML parser is not needed per write.
  const { policyFromText } = await import('./policy.js');
  let policyResult: ReturnType<typeof policyFromText>;
  try {
    policyResult = policyFromText(deps.readPolicyFile(repoRoot));
  } catch (err) {
    policyResult = {
      policy: { forbidden: [], no_project: 'allow_with_warning', error: `could not read the file: ${(err as Error).message}` },
      hash: null,
    };
  }
  const { policy, hash } = policyResult;

  const cache: SessionCache = {
    host: ctx.host,
    session_id: ctx.sessionId,
    repo_root: repoRoot,
    remote,
    project_id: null,
    project_slug: null,
    strictness: null,
    stored_strictness: null,
    source: null,
    policy_hash: hash,
    forbidden_globs: policy.forbidden,
    no_project: policy.no_project,
    policy_error: policy.error,
    wording: {},
    next_task: null,
    stale: false,
    registered: false,
    binding: existing?.binding ?? null,
    bound_at: existing?.bound_at ?? null,
    held_turn_prompt_id: existing?.held_turn_prompt_id ?? null,
    degraded_reason: null,
  };

  if (!remote) return { ...cache, degraded_reason: 'no_remote' };
  const client = clientFor(ctx, repoRoot);
  if (!client) return { ...cache, degraded_reason: 'no_credentials' };

  const r = await client.post(ROUTE_SESSION, {
    host: ctx.host,
    host_session_id: ctx.sessionId,
    repo_root: repoRoot,
    remote,
    policy_hash: hash,
    hook_version: HOOK_VERSION,
    hook_contract: HOOK_CONTRACT,
  });

  if (r.kind === 'unreachable') {
    deps.log(`ceetrix-hook: registration failed: server unreachable (${r.error})`);
    return { ...cache, degraded_reason: 'server_unreachable' };
  }
  if (r.kind === 'http_error' || !r.body?.ok) {
    const error = typeof r.body?.error === 'string' ? r.body.error : `server_error_${r.status}`;
    deps.log(`ceetrix-hook: registration refused: ${error}`);
    return { ...cache, degraded_reason: error };
  }
  const strictness = strictnessOf(r.body.strictness);
  if (!strictness) {
    deps.log('ceetrix-hook: registration reply has no valid strictness');
    return { ...cache, degraded_reason: 'invalid_reply' };
  }
  return {
    ...cache,
    project_id: r.body.project_id ?? null,
    project_slug: r.body.project_slug ?? null,
    strictness,
    stored_strictness: r.body.stored_strictness ?? null,
    source: r.body.source ?? null,
    wording: r.body.wording && typeof r.body.wording === 'object' ? r.body.wording : {},
    next_task: r.body.next_task ?? null,
    stale: r.body.stale === true,
    registered: true,
  };
}

/** Ask the server to bind, or record a retry binding when it cannot be reached. */
async function bind(ctx: Context, cache: SessionCache, storyId: string, seq: number): Promise<SessionCache> {
  const client = clientFor(ctx, cache.repo_root);
  const retry: Binding = { story_id: storyId, seq, title: '', body: '', expected_scope: [], forbidden: [], retry: true };
  if (!client) return { ...cache, binding: retry, bound_at: new Date(ctx.deps.now()).toISOString() };

  const r = await client.post(ROUTE_BIND, {
    host_session_id: ctx.sessionId,
    host: ctx.host,
    story_id: storyId,
    seq,
    observed_status: IN_PROGRESS,
  });
  if (r.kind === 'unreachable') {
    ctx.deps.log(`ceetrix-hook: bind of ${storyId}.${seq} not confirmed: server unreachable; will retry`);
    return { ...cache, binding: retry, bound_at: new Date(ctx.deps.now()).toISOString() };
  }
  if (r.kind === 'http_error' || !r.body?.ok) {
    ctx.deps.log(`ceetrix-hook: bind of ${storyId}.${seq} refused: ${r.body?.error ?? r.status}`);
    return cache;
  }
  if (r.body.status !== IN_PROGRESS) {
    ctx.deps.log(`ceetrix-hook: task ${storyId}.${seq} is ${r.body.status}, not in progress; not bound`);
    return cache;
  }
  return {
    ...cache,
    binding: {
      story_id: String(r.body.story_id ?? storyId),
      seq: typeof r.body.seq === 'number' ? r.body.seq : seq,
      title: typeof r.body.title === 'string' ? r.body.title : '',
      body: typeof r.body.body === 'string' ? r.body.body : '',
      expected_scope: strings(r.body.expected_scope),
      forbidden: strings(r.body.forbidden),
      retry: false,
    },
    bound_at: new Date(ctx.deps.now()).toISOString(),
    held_turn_prompt_id: null,
    strictness: strictnessOf(r.body.strictness) ?? cache.strictness,
    stored_strictness: r.body.stored_strictness ?? cache.stored_strictness,
    source: r.body.source ?? cache.source,
    next_task: r.body.next_task ?? null,
  };
}

async function unbind(ctx: Context, cache: SessionCache, storyId: string, seq: number): Promise<SessionCache> {
  const client = clientFor(ctx, cache.repo_root);
  if (!client) return cache;
  const r = await client.post(ROUTE_BIND, {
    host_session_id: ctx.sessionId,
    host: ctx.host,
    story_id: storyId,
    seq,
    observed_status: DONE,
  });
  if (r.kind === 'ok' && r.body?.ok && r.body.status === DONE) {
    return { ...cache, binding: null, bound_at: null, held_turn_prompt_id: null, next_task: r.body.next_task ?? cache.next_task };
  }
  ctx.deps.log(`ceetrix-hook: task ${storyId}.${seq} not confirmed done; binding kept`);
  return cache;
}

async function onSessionStart(ctx: Context): Promise<string> {
  sweepCaches(ctx.root, ctx.deps.now());
  const existing = readCache(ctx.root, ctx.host, ctx.sessionId);
  writeCache(ctx.root, await register(ctx, existing));
  return '';
}

async function onPrompt(ctx: Context): Promise<string> {
  let cache = readCache(ctx.root, ctx.host, ctx.sessionId);
  let changed = false;
  if (!cache || !cache.registered) {
    cache = await register(ctx, cache);
    changed = true;
  }
  if (cache.registered && cache.binding?.retry) {
    cache = await bind(ctx, cache, cache.binding.story_id, cache.binding.seq);
    changed = true;
  }
  if (changed) writeCache(ctx.root, cache);
  return serialise.prompt(decidePrompt(cache, ctx.deps.log));
}

function onPreTool(ctx: Context): string {
  const cache = readCache(ctx.root, ctx.host, ctx.sessionId);
  let decision: PreWriteDecision;
  try {
    decision = decidePreWrite({
      cache,
      target: writeTargetFor(ctx.payload, ctx.deps.homeDir),
      log: ctx.deps.log,
    });
  } catch (err) {
    decision = decideInternalFailure(cache, (err as Error).message, ctx.deps.log);
  }
  if (decision.outcome === 'allow' && decision.degraded) {
    ctx.deps.log(`ceetrix-hook: write allowed unchecked (degraded: ${decision.degraded})`);
  }
  return serialise.preWrite(decision);
}

async function onPostTool(ctx: Context): Promise<string> {
  if (!isCeetrixTaskTool(ctx.payload.toolName)) return '';
  const cache = readCache(ctx.root, ctx.host, ctx.sessionId);
  const d = decidePostTool(cache, ctx.payload.toolInput);
  if (d.kind === 'ignore' || !cache) return '';
  const next = d.kind === 'bind' ? await bind(ctx, cache, d.story_id, d.seq) : await unbind(ctx, cache, d.story_id, d.seq);
  writeCache(ctx.root, next);
  return '';
}

async function onTurnEnd(ctx: Context): Promise<string> {
  const cache = readCache(ctx.root, ctx.host, ctx.sessionId);
  const fetchStatus = async (): Promise<TaskStatusResult> => {
    const b = cache!.binding!;
    const client = clientFor(ctx, cache!.repo_root);
    if (!client) return { kind: 'unreachable' };
    const r = await client.get(ROUTE_TASK, {
      host_session_id: ctx.sessionId,
      host: ctx.host,
      story_id: b.story_id,
      seq: String(b.seq),
    });
    if (r.kind === 'ok' && typeof r.body?.status === 'string') return { kind: 'status', status: r.body.status };
    return { kind: 'unreachable' };
  };
  const d = await decideTurnEnd({
    cache,
    stopHookActive: ctx.payload.stopHookActive,
    promptId: ctx.payload.promptId,
    fetchStatus,
    log: ctx.deps.log,
  });
  if (cache && d.outcome === 'allow' && d.clearBinding) {
    writeCache(ctx.root, { ...cache, binding: null, bound_at: null, held_turn_prompt_id: null });
  }
  if (cache && d.outcome === 'block') {
    writeCache(ctx.root, { ...cache, held_turn_prompt_id: d.promptId });
  }
  return serialise.turnEnd(d);
}

async function onSessionEnd(ctx: Context): Promise<string> {
  const cache = readCache(ctx.root, ctx.host, ctx.sessionId);
  if (cache?.registered) {
    const client = clientFor(ctx, cache.repo_root);
    if (client) {
      const r = await client.post(
        ROUTE_SESSION_END,
        { host_session_id: ctx.sessionId, host: ctx.host },
        SESSION_END_REQUEST_TIMEOUT_MS,
      );
      if (r.kind !== 'ok') ctx.deps.log('ceetrix-hook: session end not recorded by the server');
    }
  }
  deleteCache(ctx.root, ctx.host, ctx.sessionId);
  return '';
}

/**
 * Run one hook invocation.
 *
 * @returns What to write to stdout ('' for nothing)
 */
export async function runHook(host: string, event: string, stdin: string, deps: HookDeps): Promise<string> {
  try {
    if (host !== HOST_CLAUDE_CODE) {
      deps.log(`ceetrix-hook: unsupported host "${host}"`);
      return '';
    }
    const internal = CLAUDE_CODE_EVENTS[event];
    if (!internal) {
      deps.log(`ceetrix-hook: unsupported event "${event}"`);
      return '';
    }
    const raw = JSON.parse(stdin);
    if (!raw || typeof raw !== 'object') throw new Error('payload is not an object');
    const payload = readPayload(raw as Record<string, unknown>);
    if (!payload.sessionId) throw new Error('payload has no session id');

    const ctx: Context = { host, payload, sessionId: payload.sessionId, root: stateRoot(deps.env, deps.homeDir), deps };
    switch (internal) {
      case 'session_start':
        return await onSessionStart(ctx);
      case 'prompt':
        return await onPrompt(ctx);
      case 'pre_tool':
        return onPreTool(ctx);
      case 'post_tool':
        return await onPostTool(ctx);
      case 'turn_end':
        return await onTurnEnd(ctx);
      case 'session_end':
        return await onSessionEnd(ctx);
    }
  } catch (err) {
    deps.log(`ceetrix-hook: ${event} failed open: ${(err as Error).message}`);
    return '';
  }
}

function realGit(args: string[], cwd: string): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function cli(): Promise<void> {
  const [host = '', event = ''] = process.argv.slice(2);
  const { readPolicyText } = await import('./policy.js');
  const deps: HookDeps = {
    env: process.env,
    homeDir: homedir(),
    now: () => Date.now(),
    fetchImpl: fetch,
    git: realGit,
    readPolicyFile: readPolicyText,
    log: (m) => process.stderr.write(`${m}\n`),
  };
  let stdin = '';
  try {
    stdin = await readStdin();
  } catch (err) {
    deps.log(`ceetrix-hook: could not read stdin: ${(err as Error).message}`);
  }
  const out = await runHook(host, event, stdin, deps);
  if (out) process.stdout.write(`${out}\n`);
  process.exitCode = 0;
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void cli();
}
