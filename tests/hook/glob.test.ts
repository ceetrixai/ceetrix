/**
 * Glob semantics for task scope, task forbidden lists and repo-wide forbidden
 * globs. Patterns are relative to the repo root.
 */
import { describe, it, expect } from 'vitest';
import { matchesGlob, firstMatch } from '../../src/hook/glob.js';

describe('matchesGlob', () => {
  it('** matches any depth, including zero segments', () => {
    expect(matchesGlob('src/**/x.ts', 'src/x.ts')).toBe(true);
    expect(matchesGlob('src/**/x.ts', 'src/a/b/x.ts')).toBe(true);
    expect(matchesGlob('**/x.ts', 'x.ts')).toBe(true);
    expect(matchesGlob('**/x.ts', 'a/b/x.ts')).toBe(true);
    expect(matchesGlob('src/**', 'src/a/b/c.ts')).toBe(true);
  });

  it('a path equal to the glob root matches', () => {
    expect(matchesGlob('src/hook/**', 'src/hook')).toBe(true);
  });

  it('* stays within one segment', () => {
    expect(matchesGlob('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matchesGlob('src/*.ts', 'src/a/b.ts')).toBe(false);
  });

  it('? matches exactly one character, never a separator', () => {
    expect(matchesGlob('a?.ts', 'ab.ts')).toBe(true);
    expect(matchesGlob('a?.ts', 'a.ts')).toBe(false);
    expect(matchesGlob('a?b', 'a/b')).toBe(false);
  });

  it('a pattern with no glob characters matches the exact path or anything under it', () => {
    expect(matchesGlob('src/index.ts', 'src/index.ts')).toBe(true);
    expect(matchesGlob('src/hook', 'src/hook/main.ts')).toBe(true);
    expect(matchesGlob('src/hook', 'src/hookish.ts')).toBe(false);
    expect(matchesGlob('src/index.ts', 'src/index.tsx')).toBe(false);
  });

  it('a trailing slash means directory prefix', () => {
    expect(matchesGlob('docs/', 'docs/a.md')).toBe(true);
    expect(matchesGlob('docs/', 'docs')).toBe(true);
    expect(matchesGlob('docs/', 'docsx/a.md')).toBe(false);
  });

  it('a leading ./ or / is relative to the repo root', () => {
    expect(matchesGlob('./src/a.ts', 'src/a.ts')).toBe(true);
    expect(matchesGlob('/src/a.ts', 'src/a.ts')).toBe(true);
  });

  it('regex metacharacters in patterns are literal', () => {
    expect(matchesGlob('a.b', 'axb')).toBe(false);
    expect(matchesGlob('a+(b)', 'a+(b)')).toBe(true);
  });
});

describe('firstMatch', () => {
  it('returns the first matching pattern or null', () => {
    expect(firstMatch(['x/**', 'src/**'], 'src/a.ts')).toBe('src/**');
    expect(firstMatch(['x/**'], 'src/a.ts')).toBeNull();
    expect(firstMatch([], 'src/a.ts')).toBeNull();
  });
});
