/**
 * Shared helpers for the hook program's tests (story 510).
 *
 * Fixtures under ./fixtures/claude-code are the real Claude Code 2.1.302
 * payloads captured for CC-00, with absolute home and temp paths replaced by
 * /home/dev placeholders. Their shape is untouched.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SessionCache, Binding } from '../../src/hook/types.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude-code');

/** The repository root every fixture's cwd points at. */
export const FIXTURE_REPO = '/home/dev/repo';

export type FixtureName =
  | 'session-start'
  | 'user-prompt-submit'
  | 'pre-tool-use-tool-search'
  | 'post-tool-use-tool-search'
  | 'pre-tool-use-ceetrix-task-get'
  | 'post-tool-use-ceetrix-task-get'
  | 'pre-tool-use-write'
  | 'post-tool-use-write'
  | 'stop'
  | 'session-end';

export function fixture(name: FixtureName): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

export function makeBinding(overrides: Partial<Binding> = {}): Binding {
  return {
    story_id: '510',
    seq: 2,
    title: 'Hook program',
    body: 'Build the hook program.',
    expected_scope: ['packages/ceetrix-cli/src/hook/**'],
    forbidden: ['secrets/**'],
    retry: false,
    ...overrides,
  };
}

export function makeCache(overrides: Partial<SessionCache> = {}): SessionCache {
  return {
    host: 'claude-code',
    session_id: 'c6093c60-3fe5-4fcb-850f-e45d05dcc4ab',
    repo_root: FIXTURE_REPO,
    remote: 'git@github.com:boxabirds/claude-backlog.git',
    project_id: 'p1',
    project_slug: 'boxabirds/claude-backlog',
    strictness: 'enforce',
    stored_strictness: 'strict',
    source: 'project',
    policy_hash: null,
    forbidden_globs: ['vendor/**'],
    no_project: 'allow_with_warning',
    policy_error: null,
    wording: {},
    next_task: { story_id: '510', seq: 22, title: 'Recommend one next task', capability: 'Next task' },
    stale: false,
    registered: true,
    binding: null,
    bound_at: null,
    held_turn_prompt_id: null,
    degraded_reason: null,
    ...overrides,
  };
}

/** A logger that records instead of printing. */
export function recordingLog(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
}
