/**
 * The hook program end to end, in process: real captured payloads in, host
 * output out, a real cache directory, and a fake server in place of fetch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runHook, type HookDeps } from '../../src/hook/main.js';
import { readCache, writeCache, cachePath } from '../../src/hook/cache.js';
import { HOOK_CONTRACT, SESSION_CACHE_RETENTION_MS } from '../../src/hook/constants.js';
import { fixture, makeCache, makeBinding, FIXTURE_REPO } from './helpers.js';

const SESSION = 'c6093c60-3fe5-4fcb-850f-e45d05dcc4ab';
const API_KEY = 'secret-api-key-value';
const REMOTE = 'git@github.com:boxabirds/claude-backlog.git';
const MS_PER_SECOND = 1000;

interface Call {
  method: string;
  path: string;
  body: any;
}

type Route = (call: Call) => { status: number; body: unknown } | 'unreachable';

let state: string;
let calls: Call[];
let gitCalls: string[][];
let routes: Record<string, Route>;
let remote: string | null;
let logLines: string[];

function deps(): HookDeps {
  return {
    env: { CEETRIX_STATE_DIR: state, CEETRIX_API_URL: 'http://server', CEETRIX_API_KEY: API_KEY },
    homeDir: '/home/dev',
    now: () => Date.now(),
    fetchImpl: (async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const call: Call = {
        method: init.method ?? 'GET',
        path: u.pathname,
        body: init.body ? JSON.parse(init.body as string) : Object.fromEntries(u.searchParams),
      };
      calls.push(call);
      const route = routes[`${call.method} ${call.path}`];
      const r = route ? route(call) : { status: 404, body: { ok: false } };
      if (r === 'unreachable') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch,
    git: (args: string[]) => {
      gitCalls.push(args);
      if (args.includes('--show-toplevel')) return FIXTURE_REPO;
      if (args.includes('get-url')) return remote;
      return null;
    },
    readPolicyFile: () => null,
    log: (m: string) => logLines.push(m),
  };
}

const SESSION_REPLY = {
  ok: true,
  project_id: 'p1',
  project_slug: 'boxabirds/claude-backlog',
  strictness: 'enforce',
  stored_strictness: 'strict',
  source: 'project',
  wording: {},
  next_task: { story_id: '510', seq: 22, title: 'Recommend one next task', capability: null },
  stale: false,
  expected_contract: 1,
};

const BIND_REPLY = {
  ok: true,
  story_id: '510',
  seq: 2,
  title: 'Hook program',
  body: 'Build it.',
  status: 'in-progress',
  expected_scope: ['packages/ceetrix-cli/src/hook/**'],
  forbidden: [],
  strictness: 'advise',
  stored_strictness: 'standard',
  source: 'project',
  next_task: null,
};

function run(event: string, payload: unknown): Promise<string> {
  return runHook('claude-code', event, JSON.stringify(payload), deps());
}

function cache() {
  return readCache(state, 'claude-code', SESSION);
}

function postTask(input: Record<string, unknown>) {
  return { ...fixture('post-tool-use-ceetrix-task-get'), tool_input: input };
}

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'ceetrix-main-'));
  calls = [];
  gitCalls = [];
  logLines = [];
  remote = REMOTE;
  routes = {
    'POST /api/hooks/session': () => ({ status: 200, body: SESSION_REPLY }),
    'POST /api/hooks/bind': () => ({ status: 200, body: BIND_REPLY }),
    'GET /api/hooks/task': () => ({ status: 200, body: { ok: true, status: 'in-progress', bound: true } }),
    'POST /api/hooks/session/end': () => ({ status: 200, body: { ok: true } }),
  };
});

afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});

describe('SessionStart', () => {
  it('registers and caches the reply, sending its version and contract', async () => {
    expect(await run('SessionStart', fixture('session-start'))).toBe('');
    expect(calls.length).toBe(1);
    expect(calls[0].body).toMatchObject({
      host: 'claude-code',
      host_session_id: SESSION,
      repo_root: FIXTURE_REPO,
      remote: REMOTE,
      hook_contract: HOOK_CONTRACT,
    });
    expect(typeof calls[0].body.hook_version).toBe('string');
    const c = cache()!;
    expect(c.registered).toBe(true);
    expect(c.strictness).toBe('enforce');
    expect(c.next_task?.seq).toBe(22);
  });

  it('never writes the API key to the cache', async () => {
    await run('SessionStart', fixture('session-start'));
    expect(readFileSync(cachePath(state, 'claude-code', SESSION)!, 'utf8')).not.toContain(API_KEY);
  });

  it('no remote: unregistered, no_remote, no network', async () => {
    remote = null;
    await run('SessionStart', fixture('session-start'));
    expect(calls).toEqual([]);
    expect(cache()).toMatchObject({ registered: false, degraded_reason: 'no_remote' });
  });

  it.each([
    [404, { ok: false, error: 'no_project' }, 'no_project'],
    [503, { ok: false, error: 'settings_unreadable' }, 'settings_unreadable'],
    [500, { ok: false }, 'server_error_500'],
  ])('a %s reply is unregistered with reason %s', async (status, body, reason) => {
    routes['POST /api/hooks/session'] = () => ({ status, body });
    await run('SessionStart', fixture('session-start'));
    expect(cache()).toMatchObject({ registered: false, degraded_reason: reason, strictness: null });
  });

  it('server unreachable: unregistered, server_unreachable', async () => {
    routes['POST /api/hooks/session'] = () => 'unreachable';
    await run('SessionStart', fixture('session-start'));
    expect(cache()).toMatchObject({ registered: false, degraded_reason: 'server_unreachable' });
  });

  it('sweeps caches past retention', async () => {
    writeCache(state, makeCache({ session_id: 'old' }));
    const old = (Date.now() - SESSION_CACHE_RETENTION_MS - MS_PER_SECOND) / MS_PER_SECOND;
    utimesSync(cachePath(state, 'claude-code', 'old')!, old, old);
    await run('SessionStart', fixture('session-start'));
    expect(existsSync(cachePath(state, 'claude-code', 'old')!)).toBe(false);
  });

  it('a resumed session keeps its binding', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    await run('SessionStart', { ...fixture('session-start'), source: 'resume' });
    expect(cache()!.binding).toEqual(makeBinding());
  });
});

describe('PreToolUse', () => {
  it('denies an unbound enforce write, with no network and no git', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    const out = await run('PreToolUse', fixture('pre-tool-use-write'));
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/^\[enforce\] No Ceetrix task is bound/);
    expect(calls).toEqual([]);
    expect(gitCalls).toEqual([]);
  });

  it('a missing cache allows with no output and records degraded', async () => {
    expect(await run('PreToolUse', fixture('pre-tool-use-write'))).toBe('');
    expect(logLines.join('\n')).toMatch(/cache_missing/);
  });

  it('a non-write tool produces nothing', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    expect(await run('PreToolUse', fixture('pre-tool-use-tool-search'))).toBe('');
  });
});

describe('UserPromptSubmit', () => {
  it('missing cache retries registration once, then renders', async () => {
    const out = await run('UserPromptSubmit', fixture('user-prompt-submit'));
    expect(calls.map((c) => c.path)).toEqual(['/api/hooks/session']);
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toMatch(/^No Ceetrix task is bound to this session, and this project requires one/);
  });

  it('retry that still fails renders the settings-unknown note', async () => {
    routes['POST /api/hooks/session'] = () => 'unreachable';
    const out = await run('UserPromptSubmit', fixture('user-prompt-submit'));
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toMatch(/could not determine this project's settings/);
  });

  it('a registered session renders without contacting the server', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    const out = await run('UserPromptSubmit', fixture('user-prompt-submit'));
    expect(calls).toEqual([]);
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toMatch(/^Ceetrix task 510\.2: Hook program/);
  });

  it('none outputs nothing', async () => {
    writeCache(state, makeCache({ session_id: SESSION, strictness: 'none' }));
    expect(await run('UserPromptSubmit', fixture('user-prompt-submit'))).toBe('');
  });
});

describe('PostToolUse and binding', () => {
  it('update in-progress binds, takes scope and the returned strictness, then a write in scope is allowed', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    await run('PostToolUse', postTask({ action: 'update', story_id: '510', seq: 2, status: 'in-progress' }));
    expect(calls[0]).toMatchObject({ path: '/api/hooks/bind', body: { host_session_id: SESSION, host: 'claude-code', story_id: '510', seq: 2, observed_status: 'in-progress' } });
    const c = cache()!;
    expect(c.binding).toMatchObject({ story_id: '510', seq: 2, title: 'Hook program', expected_scope: ['packages/ceetrix-cli/src/hook/**'], retry: false });
    expect(c.strictness).toBe('advise');
    expect(c.bound_at).not.toBeNull();

    const write = { ...fixture('pre-tool-use-write'), tool_input: { file_path: `${FIXTURE_REPO}/packages/ceetrix-cli/src/hook/x.ts`, content: 'x' } };
    expect(await run('PreToolUse', write)).toBe('');
  });

  it('a bind reply whose status is not in-progress does not bind', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    routes['POST /api/hooks/bind'] = () => ({ status: 200, body: { ...BIND_REPLY, status: 'proposed' } });
    await run('PostToolUse', postTask({ action: 'update', story_id: '510', seq: 2, status: 'in-progress' }));
    expect(cache()!.binding).toBeNull();
  });

  it('server unreachable on bind: retry binding with unrestricted scope, retried on next prompt', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    routes['POST /api/hooks/bind'] = () => 'unreachable';
    await run('PostToolUse', postTask({ action: 'update', story_id: '510', seq: 2, status: 'in-progress' }));
    expect(cache()!.binding).toMatchObject({ story_id: '510', seq: 2, expected_scope: [], retry: true });

    const anywhere = { ...fixture('pre-tool-use-write'), tool_input: { file_path: `${FIXTURE_REPO}/README.md`, content: 'x' } };
    expect(await run('PreToolUse', anywhere)).toBe('');

    routes['POST /api/hooks/bind'] = () => ({ status: 200, body: BIND_REPLY });
    await run('UserPromptSubmit', fixture('user-prompt-submit'));
    expect(cache()!.binding).toMatchObject({ retry: false, title: 'Hook program' });
  });

  it('complete of the bound task posts done and clears the binding when the server says done', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    routes['POST /api/hooks/bind'] = () => ({ status: 200, body: { ...BIND_REPLY, status: 'done' } });
    await run('PostToolUse', postTask({ action: 'complete', story_id: '510', seq: 2 }));
    expect(calls[0].body.observed_status).toBe('done');
    expect(cache()!.binding).toBeNull();
  });

  it('a refused completion (task still in progress) keeps the binding', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    await run('PostToolUse', postTask({ action: 'complete', story_id: '510', seq: 2 }));
    expect(cache()!.binding).not.toBeNull();
  });

  it('the captured get call is ignored', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    await run('PostToolUse', fixture('post-tool-use-ceetrix-task-get'));
    expect(calls).toEqual([]);
  });
});

describe('Stop', () => {
  it('bound and not done: blocks once per prompt', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    const out = await run('Stop', fixture('stop'));
    expect(JSON.parse(out)).toEqual({ decision: 'block', reason: expect.stringMatching(/^Ceetrix task 510\.2 \(Hook program\)/) });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/hooks/task', body: { host_session_id: SESSION, story_id: '510', seq: '2' } });
    expect(cache()!.held_turn_prompt_id).toBe('0a93645d-f000-4c38-9a99-651b232b687f');
    expect(await run('Stop', fixture('stop'))).toBe('');
  });

  it('done clears the binding and allows', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    routes['GET /api/hooks/task'] = () => ({ status: 200, body: { ok: true, status: 'done', bound: false } });
    expect(await run('Stop', fixture('stop'))).toBe('');
    expect(cache()!.binding).toBeNull();
  });

  it('404 unknown_session allows (fail open)', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    routes['GET /api/hooks/task'] = () => ({ status: 404, body: { ok: false, error: 'unknown_session' } });
    expect(await run('Stop', fixture('stop'))).toBe('');
    expect(cache()!.binding).not.toBeNull();
  });

  it('server unreachable allows', async () => {
    writeCache(state, makeCache({ session_id: SESSION, binding: makeBinding() }));
    routes['GET /api/hooks/task'] = () => 'unreachable';
    expect(await run('Stop', fixture('stop'))).toBe('');
  });
});

describe('SessionEnd', () => {
  it('posts session end and deletes the cache', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    expect(await run('SessionEnd', fixture('session-end'))).toBe('');
    expect(calls[0]).toMatchObject({ path: '/api/hooks/session/end', body: { host_session_id: SESSION, host: 'claude-code' } });
    expect(cache()).toBeNull();
  });

  it('deletes the cache when the server answers 404 unknown_session', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    routes['POST /api/hooks/session/end'] = () => ({ status: 404, body: { ok: false, error: 'unknown_session' } });
    expect(await run('SessionEnd', fixture('session-end'))).toBe('');
    expect(cache()).toBeNull();
  });

  it('deletes the cache even when the server is unreachable', async () => {
    writeCache(state, makeCache({ session_id: SESSION }));
    routes['POST /api/hooks/session/end'] = () => 'unreachable';
    await run('SessionEnd', fixture('session-end'));
    expect(cache()).toBeNull();
  });
});

describe('robustness', () => {
  it('invalid stdin outputs nothing and logs', async () => {
    expect(await runHook('claude-code', 'PreToolUse', '{not json', deps())).toBe('');
    expect(logLines.length).toBeGreaterThan(0);
  });

  it('an unknown host outputs nothing and never calls the server', async () => {
    expect(await runHook('other-host', 'SessionStart', JSON.stringify(fixture('session-start')), deps())).toBe('');
    expect(calls).toEqual([]);
  });

  it('an unknown event outputs nothing', async () => {
    expect(await runHook('claude-code', 'Notification', JSON.stringify(fixture('stop')), deps())).toBe('');
  });
});
