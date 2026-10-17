/**
 * The bundled hook program must not pull in the interactive CLI's
 * dependencies (@inquirer/prompts, open) or anything from src/ outside
 * src/hook/. The hook runs on every write; whatever it imports is loaded on
 * every write.
 *
 * setup.ts is excluded: it is used by the `ceetrix hooks` command, not by the
 * bundle, and main.ts must not import it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';

const HOOK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'hook');
const ALLOWED_PACKAGES = new Set(['yaml']);
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2]);
}

describe('hook program imports', () => {
  const bundled = files(HOOK_DIR).filter((f) => !f.endsWith('setup.ts'));

  it('finds the hook sources', () => {
    expect(bundled.some((f) => f.endsWith('main.ts'))).toBe(true);
  });

  for (const file of bundled) {
    it(`${relative(HOOK_DIR, file)} imports only builtins, yaml, or src/hook modules`, () => {
      for (const spec of importsOf(file)) {
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          expect(target.startsWith(HOOK_DIR), `${spec} leaves src/hook`).toBe(true);
          expect(target.endsWith('setup.js'), `${spec} is setup`).toBe(false);
        } else {
          const bare = spec.replace(/^node:/, '');
          expect(builtinModules.includes(bare) || ALLOWED_PACKAGES.has(bare), `${spec} is not allowed`).toBe(true);
        }
      }
    });
  }
});
