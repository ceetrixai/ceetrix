/**
 * Types shared by the hook program's modules (story 510).
 */

export type Strictness = 'none' | 'advise' | 'enforce';

export type NoProjectPolicy = 'allow_with_warning' | 'deny';

export interface NextTask {
  story_id: string;
  seq: number;
  title: string;
  capability: string | null;
}

export interface Binding {
  story_id: string;
  seq: number;
  title: string;
  body: string;
  expected_scope: string[];
  forbidden: string[];
  /** The bind request did not reach the server: scope unknown, treated as unrestricted. */
  retry: boolean;
}

/**
 * One session's cache file. Never holds a credential.
 *
 * `no_project` is not in the contract's field list; it carries the policy's
 * no_project setting so the per-write path need not re-read the policy file.
 */
export interface SessionCache {
  host: string;
  session_id: string;
  repo_root: string;
  remote: string | null;
  project_id: string | number | null;
  project_slug: string | null;
  strictness: Strictness | null;
  stored_strictness: string | null;
  source: string | null;
  policy_hash: string | null;
  forbidden_globs: string[];
  no_project: NoProjectPolicy;
  policy_error: string | null;
  wording: Record<string, string>;
  next_task: NextTask | null;
  stale: boolean;
  registered: boolean;
  binding: Binding | null;
  bound_at: string | null;
  held_turn_prompt_id: string | null;
  degraded_reason: string | null;
}

/** What a tool call writes. "unknown" is never treated as "none". */
export type WriteTarget =
  | { kind: 'none' }
  | { kind: 'paths'; paths: string[] }
  | { kind: 'unknown'; reason: string };

export type Logger = (message: string) => void;
