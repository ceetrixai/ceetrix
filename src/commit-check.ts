/**
 * Story 489: is a recorded commit reachable from this checkout?
 *
 * Ceetrix records the commit a task was completed at. The server cannot check
 * whether that commit exists — it runs without a filesystem and can reach no
 * repository — so the check belongs here, where the code is.
 *
 * THREE outcomes, not two. "We looked and it is not here" and "we could not
 * look" support entirely different conclusions, and collapsing them would
 * reintroduce the inference this whole story exists to remove: that an absent
 * commit means absent work.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Timeout for git commands, matching src/git.ts. */
const GIT_COMMAND_TIMEOUT_MS = 5000;

/**
 * Accepted identifier shape.
 *
 * Must match classifyCommitSha in workers/taskmgr/src/tools/accountability.ts.
 * The two cannot share code — separate packages — so they are kept in step by
 * hand and this comment is the reminder.
 */
const COMMIT_SHA_MIN_LENGTH = 7;
const COMMIT_SHA_MAX_LENGTH = 40;
const HEX = /^[0-9a-fA-F]+$/;

export type Reachability = 'reachable' | 'not-reachable' | 'undetermined';

/**
 * How a git command is run. Injectable solely so the failure path below can be
 * exercised: a command that fails must yield undetermined, never a definite
 * answer, and that path exists because an earlier version mapped a failed
 * containment query to "no branch contains it" and reported a commit sitting on
 * the current branch as absent.
 */
export type GitRunner = (command: string, cwd: string) => Promise<string>;

const defaultRunner: GitRunner = async (command, cwd) => {
  const { stdout } = await execAsync(command, { cwd, timeout: GIT_COMMAND_TIMEOUT_MS });
  return stdout;
};

/** Exit statuses, distinct so a caller need not parse text. */
export const EXIT_REACHABLE = 0;
export const EXIT_NOT_REACHABLE = 1;
export const EXIT_UNDETERMINED = 2;

export interface ReachabilityResult {
  outcome: Reachability;
  /** Why, in one line. Always present, including for reachable. */
  reason: string;
}

function isWellFormed(sha: string): boolean {
  const t = sha.trim();
  return (
    t.length >= COMMIT_SHA_MIN_LENGTH &&
    t.length <= COMMIT_SHA_MAX_LENGTH &&
    HEX.test(t)
  );
}

/**
 * Ask this repository whether the work behind an identifier is present.
 *
 * The question is REACHABILITY FROM A REF, not object existence. `cat-file -e`
 * alone is wrong: after `git commit --amend` the original commit lingers as an
 * unreferenced object until garbage collection, so an existence test reports
 * "present" for work that is in no branch and no longer part of any history.
 * That was found by testing the amend case, which is the case that matters most
 * because amending after a failed hook is entirely routine.
 *
 * So: does any ref contain it? If an object exists but no ref contains it, that
 * is still not-reachable, but it is worth saying so — a lingering unreferenced
 * object is strong evidence the commit was rewritten here rather than never
 * having arrived.
 *
 * ^{commit} is peeled so a tree or blob sharing the name does not count.
 */
export async function checkReachable(
  sha: string,
  cwd: string = process.cwd(),
  run: GitRunner = defaultRunner
): Promise<ReachabilityResult> {
  if (!isWellFormed(sha)) {
    return {
      outcome: 'undetermined',
      reason: `'${sha}' is not a commit identifier (expected ${COMMIT_SHA_MIN_LENGTH} to ${COMMIT_SHA_MAX_LENGTH} hexadecimal characters), so nothing was looked up.`,
    };
  }

  const id = sha.trim();

  try {
    await run('git rev-parse --is-inside-work-tree', cwd);
  } catch {
    return {
      outcome: 'undetermined',
      reason: 'Not inside a git repository, so nothing was looked up.',
    };
  }

  let objectExists = true;
  try {
    await run(`git cat-file -e ${id}^{commit}`, cwd);
  } catch {
    objectExists = false;
  }

  if (!objectExists) {
    return {
      outcome: 'not-reachable',
      reason: 'This commit is not in this repository at all.',
    };
  }

  // Plain --contains, with no --format: the format string %(refname) contains
  // parentheses, which the shell treats as syntax, so the command fails and the
  // answer is lost. Empty output here means no ref contains the commit.
  let containedBy: string;
  try {
    containedBy = (await run(`git branch --all --contains ${id}`, cwd)).trim();
  } catch {
    // Do NOT map a failed command to "no branch contains it". Failing to ask is
    // not the same as asking and being told no, and reporting it as a definite
    // answer is the exact mistake this command exists to prevent.
    return {
      outcome: 'undetermined',
      reason:
        'The commit object exists here, but which branches contain it could not be determined.',
    };
  }

  if (containedBy.length > 0) {
    const first = containedBy.split('\n')[0].replace(/^[*+]\s*/, '').trim();
    return {
      outcome: 'reachable',
      reason: `This commit is present, contained by: ${first}`,
    };
  }

  return {
    outcome: 'not-reachable',
    reason:
      'The commit object is still in this repository but no branch contains it. ' +
      'That usually means history was rewritten here - amended, rebased or squashed.',
  };
}

/**
 * What an absent commit does and does not mean.
 *
 * Kept in step with the published `task.commit_not_found` prompt, which is
 * authoritative for server-side surfaces. Bundled rather than fetched so this
 * command works offline and in a repository that has never contacted Ceetrix.
 */
export const NOT_REACHABLE_GUIDANCE = `
This means the work is UNVERIFIED FROM HERE. It does NOT mean the work is lost,
missing, unfinished, or not done. Do not describe it in those terms, and do not
re-implement the work on this basis.

Two ordinary explanations exist and cannot be told apart from here:

  1. The work is committed on another machine or checkout that has not been
     shared yet.
  2. The commit was replaced when history was tidied - amended, rebased, or
     squashed. The recorded identifier then exists nowhere, and its absence
     proves nothing at all.

To settle it: push from the machine holding the work, fetch here, and look
again. If the commit appears, the work is present and confirmed. If history was
tidied the identifier is gone permanently - confirm the state of the work by
asking the person instead.
`.trim();

/** Exit status for an outcome. */
export function exitCodeFor(outcome: Reachability): number {
  switch (outcome) {
    case 'reachable':
      return EXIT_REACHABLE;
    case 'not-reachable':
      return EXIT_NOT_REACHABLE;
    case 'undetermined':
      return EXIT_UNDETERMINED;
  }
}

/** Render what a person or agent sees. */
export function formatResult(sha: string, result: ReachabilityResult): string {
  const header = `${result.outcome}: ${sha}`;
  if (result.outcome === 'not-reachable') {
    return `${header}\n${result.reason}\n\n${NOT_REACHABLE_GUIDANCE}`;
  }
  return `${header}\n${result.reason}`;
}

/**
 * Run the command. Returns the exit status rather than calling process.exit,
 * so it can be tested without ending the test process.
 */
export async function runCheckCommit(args: string[]): Promise<number> {
  const sha = args[0];
  if (!sha) {
    console.error('Usage: ceetrix check-commit <commit>');
    console.error('Obtain one with: git rev-parse HEAD');
    return EXIT_UNDETERMINED;
  }

  const result = await checkReachable(sha);
  const text = formatResult(sha, result);

  if (result.outcome === 'reachable') {
    console.log(text);
  } else {
    console.error(text);
  }

  return exitCodeFor(result.outcome);
}
