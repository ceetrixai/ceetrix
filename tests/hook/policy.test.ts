/**
 * .ceetrix/policy.yaml parsing. Strictness is never a policy setting: a file
 * naming it is malformed, so it cannot be mistaken for a way to lower it.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parsePolicy, readPolicy, DEFAULT_POLICY_TEXT } from '../../src/hook/policy.js';

describe('parsePolicy', () => {
  it('an absent file gives the defaults with no error', () => {
    expect(parsePolicy(null)).toEqual({ forbidden: [], no_project: 'allow_with_warning', error: null });
  });

  it('an empty file gives the defaults with no error', () => {
    expect(parsePolicy('')).toEqual({ forbidden: [], no_project: 'allow_with_warning', error: null });
  });

  it('reads forbidden globs and no_project', () => {
    expect(parsePolicy('forbidden:\n  - vendor/**\n  - "*.pem"\nno_project: deny\n')).toEqual({
      forbidden: ['vendor/**', '*.pem'],
      no_project: 'deny',
      error: null,
    });
  });

  it('the default text written by setup parses to the defaults', () => {
    expect(parsePolicy(DEFAULT_POLICY_TEXT)).toEqual({ forbidden: [], no_project: 'allow_with_warning', error: null });
  });

  it('a strictness key is malformed', () => {
    const p = parsePolicy('strictness: none\nforbidden: []\n');
    expect(p.error).toMatch(/strictness/);
  });

  it.each([
    ['invalid YAML', 'forbidden: [a, b\n'],
    ['not a mapping', '- a\n- b\n'],
    ['forbidden not a list', 'forbidden: vendor\n'],
    ['forbidden entry not a string', 'forbidden: [1]\n'],
    ['no_project value unknown', 'no_project: maybe\n'],
  ])('%s is malformed', (_label, text) => {
    const p = parsePolicy(text);
    expect(p.error).toBeTruthy();
    expect(p.forbidden).toEqual([]);
  });
});

describe('readPolicy', () => {
  it('reads the file under the repo and hashes its content', () => {
    const repo = mkdtempSync(join(tmpdir(), 'ceetrix-policy-'));
    try {
      expect(readPolicy(repo)).toEqual({
        policy: { forbidden: [], no_project: 'allow_with_warning', error: null },
        hash: null,
      });
      mkdirSync(join(repo, '.ceetrix'));
      writeFileSync(join(repo, '.ceetrix', 'policy.yaml'), 'forbidden: [x/**]\n');
      const r = readPolicy(repo);
      expect(r.policy.forbidden).toEqual(['x/**']);
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
