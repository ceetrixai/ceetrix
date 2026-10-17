/**
 * Named constants for the Ceetrix hook program (story 510).
 *
 * The values marked "contract" are shared with the server and the design;
 * change them there first.
 */

const MS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;
const SESSION_CACHE_RETENTION_DAYS = 7;

/** Contract: a write decision's p95 wall time budget, and the sample it is measured over. */
export const PER_WRITE_BUDGET_MS = 75;
export const PER_WRITE_BUDGET_SAMPLE_COUNT = 50;

/** Contract: Claude Code's per-hook timeout. Claude Code reads `timeout` in seconds. */
export const HOOK_TIMEOUT_MS = 5000;
export const HOOK_TIMEOUT_SECONDS = HOOK_TIMEOUT_MS / MS_PER_SECOND;

/** Contract: session caches older than this are removed at session start. */
export const SESSION_CACHE_RETENTION_MS = SESSION_CACHE_RETENTION_DAYS * SECONDS_PER_DAY * MS_PER_SECOND;

/** Contract: the hook-to-server contract this program speaks. */
export const HOOK_CONTRACT = 1;

/** Contract: how long one server request may take. Well under HOOK_TIMEOUT_MS. */
export const SERVER_REQUEST_TIMEOUT_MS = 3000;

/** Session end is best effort; the developer is leaving and nothing waits on it. */
export const SESSION_END_REQUEST_TIMEOUT_MS = 1000;

/** How long a git command at session start may take. */
export const GIT_COMMAND_TIMEOUT_MS = 2000;

/**
 * The program's version, substituted at bundle time from package.json by
 * `bun build --define`. Nothing is read at runtime. Unbundled (tests, tsc
 * output) it reports UNBUNDLED_VERSION.
 */
declare const __CEETRIX_HOOK_VERSION__: string | undefined;
const UNBUNDLED_VERSION = '0.0.0-unbundled';
export const HOOK_VERSION: string =
  typeof __CEETRIX_HOOK_VERSION__ === 'string' ? __CEETRIX_HOOK_VERSION__ : UNBUNDLED_VERSION;

/** Hosts this program has an adapter for. */
export const HOST_CLAUDE_CODE = 'claude-code';

/** Repo-resident Ceetrix directory and the files under it. */
export const CEETRIX_DIR = '.ceetrix';
export const POLICY_FILE = 'policy.yaml';
export const HOOK_DIR = 'hook';
export const HOOK_FILE_NAME = 'ceetrix-hook.mjs';

/** Session cache permissions. */
export const CACHE_FILE_MODE = 0o600;
export const CACHE_DIR_MODE = 0o700;

/** Server routes. */
export const ROUTE_SESSION = '/api/hooks/session';
export const ROUTE_BIND = '/api/hooks/bind';
export const ROUTE_TASK = '/api/hooks/task';
export const ROUTE_SESSION_END = '/api/hooks/session/end';
