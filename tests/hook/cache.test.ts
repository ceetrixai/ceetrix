/**
 * Session cache: one file per (host, session id), mode 0600 in a 0700
 * directory, written atomically, swept after the retention period.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readdirSync, utimesSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  stateRoot,
  cachePath,
  readCache,
  writeCache,
  deleteCache,
  sweepCaches,
} from '../../src/hook/cache.js';
import { SESSION_CACHE_RETENTION_MS, CACHE_FILE_MODE, CACHE_DIR_MODE } from '../../src/hook/constants.js';
import { makeCache } from './helpers.js';

/** Permission bits only. */
const MODE_MASK = 0o777;
const MS_PER_SECOND = 1000;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ceetrix-cache-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('stateRoot', () => {
  it('CEETRIX_STATE_DIR overrides', () => {
    expect(stateRoot({ CEETRIX_STATE_DIR: '/x' }, '/home/dev')).toBe('/x');
  });
  it('XDG_STATE_HOME is used when set', () => {
    expect(stateRoot({ XDG_STATE_HOME: '/state' }, '/home/dev')).toBe('/state/ceetrix');
  });
  it('defaults to ~/.ceetrix', () => {
    expect(stateRoot({}, '/home/dev')).toBe('/home/dev/.ceetrix');
  });
});

describe('cachePath', () => {
  it('is sessions/<host>/<session_id>.json under the root', () => {
    expect(cachePath('/r', 'claude-code', 'abc-1')).toBe('/r/sessions/claude-code/abc-1.json');
  });
  it('refuses a session id that could escape the directory', () => {
    expect(cachePath('/r', 'claude-code', '../x')).toBeNull();
    expect(cachePath('/r', 'claude-code', '')).toBeNull();
  });
});

describe('read and write', () => {
  it('a missing file reads as null', () => {
    expect(readCache(root, 'claude-code', 'nope')).toBeNull();
  });

  it('a corrupt file reads as null', () => {
    mkdirSync(join(root, 'sessions', 'claude-code'), { recursive: true });
    writeFileSync(join(root, 'sessions', 'claude-code', 's1.json'), '{not json');
    expect(readCache(root, 'claude-code', 's1')).toBeNull();
  });

  it('round-trips, with 0600 file and 0700 directory, and leaves no temp file', () => {
    const cache = makeCache({ session_id: 's1' });
    writeCache(root, cache);
    const file = cachePath(root, 'claude-code', 's1')!;
    expect(statSync(file).mode & MODE_MASK).toBe(CACHE_FILE_MODE);
    expect(statSync(join(root, 'sessions', 'claude-code')).mode & MODE_MASK).toBe(CACHE_DIR_MODE);
    expect(readdirSync(join(root, 'sessions', 'claude-code'))).toEqual(['s1.json']);
    expect(readCache(root, 'claude-code', 's1')).toEqual(cache);
  });

  it('an overwrite replaces the whole file atomically', () => {
    writeCache(root, makeCache({ session_id: 's1', stale: false }));
    writeCache(root, makeCache({ session_id: 's1', stale: true }));
    expect(readCache(root, 'claude-code', 's1')!.stale).toBe(true);
    expect(readdirSync(join(root, 'sessions', 'claude-code'))).toEqual(['s1.json']);
  });

  it('two session ids are two separate files', () => {
    writeCache(root, makeCache({ session_id: 'a', strictness: 'advise' }));
    writeCache(root, makeCache({ session_id: 'b', strictness: 'enforce' }));
    expect(readCache(root, 'claude-code', 'a')!.strictness).toBe('advise');
    expect(readCache(root, 'claude-code', 'b')!.strictness).toBe('enforce');
    expect(readdirSync(join(root, 'sessions', 'claude-code')).sort()).toEqual(['a.json', 'b.json']);
  });

  it('deleteCache removes the file and tolerates absence', () => {
    writeCache(root, makeCache({ session_id: 's1' }));
    deleteCache(root, 'claude-code', 's1');
    expect(existsSync(cachePath(root, 'claude-code', 's1')!)).toBe(false);
    expect(() => deleteCache(root, 'claude-code', 's1')).not.toThrow();
  });
});

describe('sweepCaches', () => {
  it('keeps a file exactly at the retention boundary and removes one just past it', () => {
    const now = Date.UTC(2026, 9, 17);
    writeCache(root, makeCache({ session_id: 'at' }));
    writeCache(root, makeCache({ session_id: 'past' }));
    writeCache(root, makeCache({ session_id: 'fresh' }));
    // mtime has one-second resolution on some filesystems, so the "past" file
    // is one second older than the boundary.
    const at = (now - SESSION_CACHE_RETENTION_MS) / MS_PER_SECOND;
    const past = (now - SESSION_CACHE_RETENTION_MS - MS_PER_SECOND) / MS_PER_SECOND;
    utimesSync(cachePath(root, 'claude-code', 'at')!, at, at);
    utimesSync(cachePath(root, 'claude-code', 'past')!, past, past);
    utimesSync(cachePath(root, 'claude-code', 'fresh')!, now / MS_PER_SECOND, now / MS_PER_SECOND);

    const removed = sweepCaches(root, now);

    expect(removed.map((p) => p.split('/').pop())).toEqual(['past.json']);
    expect(readdirSync(join(root, 'sessions', 'claude-code')).sort()).toEqual(['at.json', 'fresh.json']);
  });

  it('a missing state directory sweeps nothing', () => {
    expect(sweepCaches(join(root, 'absent'), Date.now())).toEqual([]);
  });
});
