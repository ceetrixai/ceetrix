/**
 * The repo's .ceetrix/policy.yaml (story 510).
 *
 * Two settings: `forbidden` (repo-wide globs no task may write) and
 * `no_project` (what to do when the repo has no Ceetrix project). Strictness
 * is deliberately not one of them: it is set in the project's settings, and a
 * file naming it is malformed so it cannot pass for a way to lower it.
 *
 * A malformed file is reported, not repaired: the caller enforces, warns or
 * ignores according to strictness.
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { parse } from 'yaml';
import { CEETRIX_DIR, POLICY_FILE } from './constants.js';
import type { NoProjectPolicy } from './types.js';

export interface Policy {
  forbidden: string[];
  no_project: NoProjectPolicy;
  /** Why the file could not be used, or null. */
  error: string | null;
}

const NO_PROJECT_VALUES: readonly NoProjectPolicy[] = ['allow_with_warning', 'deny'];
const DEFAULT_NO_PROJECT: NoProjectPolicy = 'allow_with_warning';
const STRICTNESS_KEY = 'strictness';

/** What setup writes when the repo has no policy file. */
export const DEFAULT_POLICY_TEXT = `# Ceetrix repository policy.
# forbidden: globs, relative to the repository root, that no task may write.
# no_project: what to do when this repository has no Ceetrix project:
#   allow_with_warning or deny.
# Strictness is set in the project's settings in Ceetrix, not here.
forbidden: []
no_project: ${DEFAULT_NO_PROJECT}
`;

function malformed(error: string): Policy {
  return { forbidden: [], no_project: DEFAULT_NO_PROJECT, error };
}

/**
 * Parse policy text. Null (no file) and an empty file give the defaults.
 */
export function parsePolicy(text: string | null): Policy {
  if (text === null) return { forbidden: [], no_project: DEFAULT_NO_PROJECT, error: null };

  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    return malformed(`YAML parse error: ${(err as Error).message.split('\n')[0]}`);
  }

  if (doc === null || doc === undefined) return { forbidden: [], no_project: DEFAULT_NO_PROJECT, error: null };
  if (typeof doc !== 'object' || Array.isArray(doc)) return malformed('the file is not a mapping of settings');

  const record = doc as Record<string, unknown>;
  if (STRICTNESS_KEY in record) {
    return malformed(`"${STRICTNESS_KEY}" is not a policy setting; strictness is set in the project's settings`);
  }

  const forbidden = record.forbidden ?? [];
  if (!Array.isArray(forbidden) || !forbidden.every((g) => typeof g === 'string')) {
    return malformed('"forbidden" must be a list of glob strings');
  }

  const noProject = record.no_project ?? DEFAULT_NO_PROJECT;
  if (!NO_PROJECT_VALUES.includes(noProject as NoProjectPolicy)) {
    return malformed(`"no_project" must be one of: ${NO_PROJECT_VALUES.join(', ')}`);
  }

  return { forbidden: forbidden as string[], no_project: noProject as NoProjectPolicy, error: null };
}

/** The policy file's path under a repo root. */
export function policyPath(repoRoot: string): string {
  return join(repoRoot, CEETRIX_DIR, POLICY_FILE);
}

/** Read the policy file's text, or null when it does not exist. */
export function readPolicyText(repoRoot: string): string | null {
  try {
    return readFileSync(policyPath(repoRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Parse a policy text and hash it (sha256 hex; null when absent). */
export function policyFromText(text: string | null): { policy: Policy; hash: string | null } {
  return {
    policy: parsePolicy(text),
    hash: text === null ? null : createHash('sha256').update(text).digest('hex'),
  };
}

/** Read and parse a repo's policy file. */
export function readPolicy(repoRoot: string): { policy: Policy; hash: string | null } {
  let text: string | null;
  try {
    text = readPolicyText(repoRoot);
  } catch (err) {
    return { policy: malformed(`could not read the file: ${(err as Error).message}`), hash: null };
  }
  return policyFromText(text);
}
