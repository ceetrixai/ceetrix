/**
 * Server client: where credentials come from, what is sent, and that a slow
 * server is abandoned at SERVER_REQUEST_TIMEOUT_MS rather than holding the
 * agent until Claude Code's own hook timeout.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveCredentials, createClient } from '../../src/hook/client.js';
import { SERVER_REQUEST_TIMEOUT_MS, HOOK_TIMEOUT_MS } from '../../src/hook/constants.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ceetrix-client-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('resolveCredentials', () => {
  it('uses CEETRIX_API_URL and CEETRIX_API_KEY when both are set', () => {
    expect(resolveCredentials({ CEETRIX_API_URL: 'http://localhost:8787/', CEETRIX_API_KEY: 'k' }, home, '/repo')).toEqual({ baseUrl: 'http://localhost:8787', apiKey: 'k' });
  });

  it('ignores the env pair when only one is set', () => {
    expect(resolveCredentials({ CEETRIX_API_URL: 'http://x' }, home, '/repo')).toBeNull();
  });

  it('reads ~/.claude.json mcpServers.ceetrix, stripping /mcp', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { ceetrix: { url: 'https://api.ceetrix.com/mcp', headers: { 'X-API-Key': 'user-key' } } } }));
    expect(resolveCredentials({}, home, '/repo')).toEqual({ baseUrl: 'https://api.ceetrix.com', apiKey: 'user-key' });
  });

  it('prefers a project-scoped server for the repo, stripping /sse', () => {
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: { ceetrix: { url: 'https://api.ceetrix.com/mcp', headers: { 'X-API-Key': 'user-key' } } },
        projects: { '/repo': { mcpServers: { ceetrix: { url: 'https://staging-api.ceetrix.com/sse', headers: { 'X-API-Key': 'proj-key' } } } } },
      }),
    );
    expect(resolveCredentials({}, home, '/repo')).toEqual({ baseUrl: 'https://staging-api.ceetrix.com', apiKey: 'proj-key' });
  });

  it('no config gives null', () => {
    expect(resolveCredentials({}, home, '/repo')).toBeNull();
  });
});

describe('createClient', () => {
  it('the request timeout is well under the hook timeout', () => {
    expect(SERVER_REQUEST_TIMEOUT_MS).toBeLessThan(HOOK_TIMEOUT_MS);
  });

  it('posts JSON with the API key header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createClient({ baseUrl: 'http://s', apiKey: 'k', fetchImpl });
    const r = await client.post('/api/hooks/session', { a: 1 });
    expect(r).toEqual({ kind: 'ok', status: 200, body: { ok: true } });
    expect(calls[0].url).toBe('http://s/api/hooks/session');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['X-API-Key']).toBe('k');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ a: 1 });
  });

  it('a GET carries the query string', async () => {
    let seen = '';
    const fetchImpl = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify({ ok: true, status: 'done', bound: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createClient({ baseUrl: 'http://s', apiKey: 'k', fetchImpl });
    await client.get('/api/hooks/task', { host_session_id: 's', host: 'claude-code', story_id: '510', seq: '2' });
    expect(seen).toBe('http://s/api/hooks/task?host_session_id=s&host=claude-code&story_id=510&seq=2');
  });

  it('a non-2xx reply is an http error carrying the body', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: false, error: 'no_project' }), { status: 404 })) as unknown as typeof fetch;
    const client = createClient({ baseUrl: 'http://s', apiKey: 'k', fetchImpl });
    expect(await client.post('/x', {})).toEqual({ kind: 'http_error', status: 404, body: { ok: false, error: 'no_project' } });
  });

  it('a network error is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = createClient({ baseUrl: 'http://s', apiKey: 'k', fetchImpl });
    expect((await client.post('/x', {})).kind).toBe('unreachable');
  });

  it('a server slower than the timeout is abandoned as unreachable', async () => {
    const SHORT_TIMEOUT_MS = 20;
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const client = createClient({ baseUrl: 'http://s', apiKey: 'k', fetchImpl, timeoutMs: SHORT_TIMEOUT_MS });
    const started = Date.now();
    const r = await client.post('/x', {});
    expect(r.kind).toBe('unreachable');
    expect(Date.now() - started).toBeLessThan(SERVER_REQUEST_TIMEOUT_MS);
  });
});
