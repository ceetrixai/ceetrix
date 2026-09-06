/**
 * Story 489: is a recorded commit reachable from this checkout?
 *
 * Every case runs against real temporary git repositories created by the test.
 * This needs no second machine, which corrects a claim made earlier in this
 * story: the case that matters most - a commit amended away - happens in ONE
 * repository on ONE machine through entirely ordinary work.
 *
 * Equivalence classes: reachable, not-reachable, undetermined. Exhaustive and
 * non-overlapping. Undetermined is asserted separately in every case rather
 * than folded into not-reachable, because a suite that treats "could not look"
 * as "not there" would pass while the product made exactly the wrong claim.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import {
  checkReachable,
  exitCodeFor,
  formatResult,
  NOT_REACHABLE_GUIDANCE,
  EXIT_REACHABLE,
  EXIT_NOT_REACHABLE,
  EXIT_UNDETERMINED,
} from '../src/commit-check.js';

/** Deterministic identity so commits are reproducible and need no user config. */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

function commitFile(repo: string, name: string, message: string): string {
  writeFileSync(join(repo, name), `${name}\n`);
  git(repo, 'add', name);
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

let root: string;
let repoA: string;
let repoB: string;
let notARepo: string;

/** A commit that lives on a branch in repoA. */
let onBranch: string;
/** A commit amended away in repoA: object lingers, no ref reaches it. */
let amendedAway: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ceetrix-commit-check-'));
  repoA = join(root, 'a');
  repoB = join(root, 'b');
  notARepo = join(root, 'plain');
  for (const d of [repoA, repoB, notARepo]) mkdirSync(d);

  git(repoA, 'init', '-q', '.');
  onBranch = commitFile(repoA, 'first.txt', 'first');
  amendedAway = commitFile(repoA, 'second.txt', 'second');
  // Rewrite history the way a failed pre-commit hook routinely causes.
  git(repoA, 'commit', '-q', '--amend', '-m', 'second amended');

  git(repoB, 'init', '-q', '.');
  commitFile(repoB, 'unrelated.txt', 'unrelated');
});

afterAll(() => {
  // Exact path returned by mkdtemp, guarded to the system temp directory.
  if (root && root.startsWith(tmpdir() + sep)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('reachable', () => {
  it('a commit on the current branch', async () => {
    const r = await checkReachable(onBranch, repoA);
    expect(r.outcome).toBe('reachable');
    expect(exitCodeFor(r.outcome)).toBe(EXIT_REACHABLE);
  });

  it('an older commit still in history', async () => {
    // onBranch is the parent of the amended head, so it is still reachable.
    const r = await checkReachable(onBranch, repoA);
    expect(r.outcome).toBe('reachable');
  });

  it('a short prefix of a real commit', async () => {
    const r = await checkReachable(onBranch.slice(0, 8), repoA);
    expect(r.outcome).toBe('reachable');
  });
});

describe('not reachable', () => {
  it('THE AMEND CASE: the object lingers but no ref contains it', async () => {
    // The case the whole command exists for, and the one a naive existence
    // check gets wrong: `git cat-file -e` alone reports this as present.
    const r = await checkReachable(amendedAway, repoA);
    expect(r.outcome).toBe('not-reachable');
    expect(exitCodeFor(r.outcome)).toBe(EXIT_NOT_REACHABLE);
    // The lingering object is itself evidence, and is reported as such.
    expect(r.reason).toMatch(/rewritten|amended|rebased|squashed/i);
  });

  it('a commit that never arrived in this repository', async () => {
    const r = await checkReachable(onBranch, repoB);
    expect(r.outcome).toBe('not-reachable');
    expect(r.reason).toMatch(/not in this repository at all/i);
  });

  it('a tree rather than a commit, sharing no commit identity', async () => {
    const tree = git(repoA, 'rev-parse', 'HEAD^{tree}');
    const r = await checkReachable(tree, repoA);
    expect(r.outcome).toBe('not-reachable');
  });
});

describe('undetermined, which must never be confused with absent', () => {
  it('outside any repository', async () => {
    const r = await checkReachable(onBranch, notARepo);
    expect(r.outcome).toBe('undetermined');
    expect(exitCodeFor(r.outcome)).toBe(EXIT_UNDETERMINED);
    expect(exitCodeFor(r.outcome)).not.toBe(EXIT_NOT_REACHABLE);
  });

  it('a malformed identifier, so nothing was looked up', async () => {
    const r = await checkReachable('nothexadecimal!!', repoA);
    expect(r.outcome).toBe('undetermined');
    expect(r.reason).toMatch(/nothing was looked up/i);
  });

  it('too short to be an identifier', async () => {
    const r = await checkReachable('abc12', repoA);
    expect(r.outcome).toBe('undetermined');
  });

  it('too long to be an identifier', async () => {
    const r = await checkReachable(onBranch + 'a', repoA);
    expect(r.outcome).toBe('undetermined');
  });

  it('empty', async () => {
    const r = await checkReachable('', repoA);
    expect(r.outcome).toBe('undetermined');
  });

  it('the three exit statuses are distinct', () => {
    const codes = [EXIT_REACHABLE, EXIT_NOT_REACHABLE, EXIT_UNDETERMINED];
    expect(new Set(codes).size).toBe(3);
  });
});

describe('what the reader is told when a commit is not reachable', () => {
  // The guidance is the point of the command. Asserted with a helper so the
  // check can itself be shown to fail, rather than assumed to work.
  const PROHIBITION = /It does NOT mean the work is[^.]*\./i;
  const FORBIDDEN = ['lost', 'missing', 'unfinished', 'not done'];

  function makesProhibitedClaim(text: string): boolean {
    const remainder = text.replace(PROHIBITION, '').toLowerCase();
    return FORBIDDEN.some((w) => remainder.includes(w));
  }

  it('the check can fail: it catches text that does make the claim', () => {
    expect(makesProhibitedClaim('The work is lost. Re-implement it.')).toBe(true);
  });

  it('says unverified from here, and never that the work is lost', () => {
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/UNVERIFIED FROM HERE/);
    expect(NOT_REACHABLE_GUIDANCE).toMatch(PROHIBITION);
    expect(makesProhibitedClaim(NOT_REACHABLE_GUIDANCE)).toBe(false);
  });

  it('forbids re-implementing on this basis', () => {
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/do not\s+re-implement/i);
  });

  it('names both indistinguishable causes and admits they cannot be told apart', () => {
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/another machine|another checkout/i);
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/amended|rebased|squashed/i);
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/cannot be told apart/i);
  });

  it('gives the resolution and states what absence does not prove', () => {
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/push/i);
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/fetch/i);
    expect(NOT_REACHABLE_GUIDANCE).toMatch(/proves nothing/i);
  });

  it('is printed for not-reachable and withheld otherwise', async () => {
    const absent = await checkReachable(amendedAway, repoA);
    expect(formatResult(amendedAway, absent)).toContain('UNVERIFIED FROM HERE');

    const present = await checkReachable(onBranch, repoA);
    expect(formatResult(onBranch, present)).not.toContain('UNVERIFIED FROM HERE');
  });

  it('never claims the commit was verified to exist elsewhere', async () => {
    const absent = await checkReachable(amendedAway, repoA);
    const text = formatResult(amendedAway, absent);
    expect(text).not.toMatch(/is on another machine|has been confirmed|was verified/i);
  });
});

describe('a failed query is never a definite answer (TC-46)', () => {
  // This path exists because an earlier version mapped a failed containment
  // query to "no branch contains it", and reported a commit sitting on the
  // current branch as absent. Injecting the runner is the only way to reach it.
  it('reports undetermined when the containment query fails', async () => {
    const { checkReachable: check } = await import('../src/commit-check.js');
    const r = await check(onBranch, repoA, async (command: string, cwd: string) => {
      if (command.startsWith('git branch')) throw new Error('simulated git failure');
      const { execFileSync } = await import('child_process');
      return execFileSync('sh', ['-c', command], { cwd, env: GIT_ENV, encoding: 'utf8' });
    });
    expect(r.outcome).toBe('undetermined');
    expect(r.outcome).not.toBe('not-reachable');
    expect(r.reason).toMatch(/could not be determined/i);
  });

  it('still answers normally when the injected runner works', async () => {
    const { checkReachable: check } = await import('../src/commit-check.js');
    const r = await check(onBranch, repoA, async (command: string, cwd: string) => {
      const { execFileSync } = await import('child_process');
      return execFileSync('sh', ['-c', command], { cwd, env: GIT_ENV, encoding: 'utf8' });
    });
    expect(r.outcome).toBe('reachable');
  });
});
