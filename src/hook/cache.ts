/**
 * Per-session cache files (story 510).
 *
 * `<root>/sessions/<host>/<session_id>.json`, where root is CEETRIX_STATE_DIR
 * when set, else $XDG_STATE_HOME/ceetrix, else ~/.ceetrix. Files are 0600 in
 * 0700 directories and written by temp file and rename, so a reader never
 * sees half a file. Never holds a credential.
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  chmodSync,
} from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { CACHE_DIR_MODE, CACHE_FILE_MODE, SESSION_CACHE_RETENTION_MS } from './constants.js';
import type { SessionCache } from './types.js';

const SESSIONS_DIR = 'sessions';
const CACHE_EXTENSION = '.json';
const TEMP_SUFFIX_BYTES = 6;
const STATE_DIR_NAME = 'ceetrix';
const HOME_STATE_DIR = '.ceetrix';

/** Host and session ids become path segments, so only safe characters pass. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function stateRoot(env: Record<string, string | undefined>, homeDir: string): string {
  if (env.CEETRIX_STATE_DIR) return env.CEETRIX_STATE_DIR;
  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, STATE_DIR_NAME);
  return join(homeDir, HOME_STATE_DIR);
}

export function cachePath(root: string, host: string, sessionId: string): string | null {
  if (!SAFE_SEGMENT.test(host) || !SAFE_SEGMENT.test(sessionId)) return null;
  return join(root, SESSIONS_DIR, host, `${sessionId}${CACHE_EXTENSION}`);
}

export function readCache(root: string, host: string, sessionId: string): SessionCache | null {
  const path = cachePath(root, host, sessionId);
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SessionCache;
  } catch {
    return null;
  }
}

export function writeCache(root: string, cache: SessionCache): void {
  const path = cachePath(root, cache.host, cache.session_id);
  if (!path) throw new Error(`unsafe session id for cache: ${cache.session_id}`);
  const dir = join(root, SESSIONS_DIR, cache.host);
  mkdirSync(dir, { recursive: true, mode: CACHE_DIR_MODE });
  chmodSync(dir, CACHE_DIR_MODE);
  const temp = `${path}.${process.pid}.${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.tmp`;
  writeFileSync(temp, JSON.stringify(cache), { mode: CACHE_FILE_MODE });
  renameSync(temp, path);
}

export function deleteCache(root: string, host: string, sessionId: string): void {
  const path = cachePath(root, host, sessionId);
  if (!path) return;
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Remove cache files older than the retention period, for every host. A file
 * exactly at the boundary is kept.
 *
 * @returns The paths removed
 */
export function sweepCaches(root: string, now: number, retentionMs: number = SESSION_CACHE_RETENTION_MS): string[] {
  const removed: string[] = [];
  let hosts: string[];
  try {
    hosts = readdirSync(join(root, SESSIONS_DIR));
  } catch {
    return removed;
  }
  for (const host of hosts) {
    const dir = join(root, SESSIONS_DIR, host);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      try {
        if (now - statSync(path).mtimeMs > retentionMs) {
          unlinkSync(path);
          removed.push(path);
        }
      } catch {
        // Gone or unreadable: nothing to sweep.
      }
    }
  }
  return removed;
}
