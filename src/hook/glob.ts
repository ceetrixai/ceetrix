/**
 * Glob matching for task scope and forbidden lists (story 510).
 *
 * Patterns are relative to the repo root. `**` matches any depth including
 * zero segments, `*` matches within one segment, `?` matches one character.
 * A pattern with no glob characters matches the exact path or anything under
 * it as a directory. A trailing `/` means directory prefix.
 */

const GLOB_CHARS = /[*?]/;
const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;
const LEADING_RELATIVE = /^(?:\.\/|\/)+/;

const compiled = new Map<string, RegExp>();

function normalise(pattern: string): string {
  return pattern.replace(LEADING_RELATIVE, '');
}

function escape(text: string): string {
  return text.replace(REGEX_SPECIAL, '\\$&');
}

function toRegExp(rawPattern: string): RegExp {
  const pattern = normalise(rawPattern);

  if (pattern.endsWith('/')) {
    const dir = escape(pattern.replace(/\/+$/, ''));
    return new RegExp(`^${dir}(?:/.*)?$`);
  }

  if (!GLOB_CHARS.test(pattern)) {
    return new RegExp(`^${escape(pattern)}(?:/.*)?$`);
  }

  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      const atStart = i === 0 || pattern[i - 1] === '/';
      const next = pattern[i + 2];
      if (atStart && next === '/') {
        // "**/" : zero or more whole segments
        out += '(?:.*/)?';
        i += 3;
        continue;
      }
      if (atStart && next === undefined && i > 0) {
        // "dir/**" : the directory itself or anything under it
        out = out.replace(/\/$/, '');
        out += '(?:/.*)?';
        i += 2;
        continue;
      }
      out += '.*';
      i += 2;
      continue;
    }
    if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escape(c);
    }
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

/**
 * Does a repo-relative path match a pattern?
 *
 * @param pattern - Glob relative to the repo root
 * @param relPath - Path relative to the repo root, `/`-separated
 */
export function matchesGlob(pattern: string, relPath: string): boolean {
  let re = compiled.get(pattern);
  if (!re) {
    re = toRegExp(pattern);
    compiled.set(pattern, re);
  }
  return re.test(relPath);
}

/** The first pattern that matches, or null. */
export function firstMatch(patterns: readonly string[], relPath: string): string | null {
  for (const p of patterns) {
    if (matchesGlob(p, relPath)) return p;
  }
  return null;
}
