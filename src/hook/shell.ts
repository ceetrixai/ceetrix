/**
 * Layer 1 write-effect detection for Bash commands (story 510).
 *
 * Reads a command line and names the files it writes, without running
 * anything. Covered: redirections `>`, `>>`, `>|`, `&>`, `&>>`, `<>` (not `>&`,
 * not to /dev/null and the other standard device files), `tee`, the last
 * argument of `cp`/`mv` (or `-t DIR`), `dd of=`, `sed -i` file arguments,
 * `touch`, `rm`, `mkdir`, `truncate`. Writes inside `$(...)`, backticks and
 * process substitutions are examined too.
 *
 * Anything that cannot be read is "unknown", never "none": `eval`, a shell
 * started with `-c`, `xargs` feeding a write command, a write target built
 * from a variable, substitution or glob, a dynamic command name, or a quote
 * left open. Interpreters (python -c, node -e, perl -i, git) are not
 * examined: Layer 1 recognises shell write effects only.
 */

import { resolve, basename } from 'path';
import type { WriteTarget } from './types.js';

/** Redirect targets that never name a file in the repo. */
const DEVICE_TARGETS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']);

/** Redirection operators whose target is written. */
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);

/** Heredoc operators. */
const HEREDOC_REDIRECTS = new Set(['<<', '<<-']);

/** Commands whose arguments cannot be read statically. */
const OPAQUE_COMMANDS = new Set(['eval']);

/** Shells that run their `-c` argument. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

/** Words that prefix a command without changing what it writes. */
const PREFIX_WORDS = new Set(['sudo', 'command', 'nohup', 'time', 'exec', 'env', 'builtin', 'nice']);

/** Reserved words that may open a command position. */
const RESERVED_WORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const FD_PREFIX = /^\d+$/;
const NAME_START = /[A-Za-z_{@*#?$!0-9-]/;
const OPERATOR_CHARS = new Set([';', '&', '|', '(', ')', '<', '>', '\n']);
const BLANK = new Set([' ', '\t']);

interface Word {
  type: 'word';
  value: string;
  /** Contains an expansion whose value is not known statically. */
  dynamic: boolean;
  /** Contains an unquoted glob character. */
  glob: boolean;
  /** Bodies of command and process substitutions inside the word. */
  inner: string[];
}

interface Operator {
  type: 'op';
  value: string;
}

interface Redirect {
  type: 'redir';
  op: string;
}

type Token = Word | Operator | Redirect;

class Unparseable extends Error {}

/** Find the index just past the `)` that closes a `(` opened before `start`. */
function matchParen(s: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) throw new Unparseable('unterminated quote');
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i = skipDoubleQuoted(s, i + 1);
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  throw new Unparseable('unterminated substitution');
}

function skipDoubleQuoted(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '"') return i + 1;
    i += 1;
  }
  throw new Unparseable('unterminated quote');
}

function matchBacktick(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '`') return i;
    i += 1;
  }
  throw new Unparseable('unterminated backtick');
}

/**
 * Read a `$` expansion at s[i] (which is `$`) into the word. Returns the new index.
 */
function readDollar(s: string, i: number, word: Word): number {
  const next = s[i + 1];
  if (next === '(' && s[i + 2] === '(') {
    // Arithmetic: its `>` is a comparison, not a redirect.
    const end = matchParen(s, i + 2);
    word.dynamic = true;
    return end + 1;
  }
  if (next === '(') {
    const end = matchParen(s, i + 2);
    word.inner.push(s.slice(i + 2, end - 1));
    word.dynamic = true;
    return end;
  }
  if (next === '{') {
    const end = s.indexOf('}', i + 2);
    if (end === -1) throw new Unparseable('unterminated parameter expansion');
    word.dynamic = true;
    return end + 1;
  }
  if (next !== undefined && NAME_START.test(next)) {
    word.dynamic = true;
    let j = i + 1;
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
    return j === i + 1 ? i + 2 : j;
  }
  word.value += '$';
  return i + 1;
}

function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  const pendingHeredocs: Array<{ delimiter: string; stripTabs: boolean }> = [];
  let expectHeredocDelimiter: string | null = null;
  let i = 0;

  const pushOp = (value: string, length: number) => {
    tokens.push({ type: 'op', value });
    i += length;
  };

  while (i < s.length) {
    const c = s[i];

    if (BLANK.has(c)) {
      i += 1;
      continue;
    }

    if (c === '\\' && s[i + 1] === '\n') {
      i += 2;
      continue;
    }

    if (c === '\n') {
      pushOp('\n', 1);
      // Skip heredoc bodies that start after this newline.
      while (pendingHeredocs.length > 0) {
        const { delimiter, stripTabs } = pendingHeredocs.shift()!;
        let found = false;
        while (i < s.length) {
          const nl = s.indexOf('\n', i);
          const line = s.slice(i, nl === -1 ? s.length : nl);
          i = nl === -1 ? s.length : nl + 1;
          if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
            found = true;
            break;
          }
        }
        if (!found) throw new Unparseable('unterminated heredoc');
      }
      continue;
    }

    if (c === '#') {
      const prev = tokens[tokens.length - 1];
      // A comment only at the start of a word.
      const nl = s.indexOf('\n', i);
      if (i === 0 || BLANK.has(s[i - 1]) || s[i - 1] === '\n' || prev?.type === 'op') {
        i = nl === -1 ? s.length : nl;
        continue;
      }
    }

    if (c === ';') {
      pushOp(';', s[i + 1] === ';' ? 2 : 1);
      continue;
    }
    if (c === '&') {
      if (s[i + 1] === '&') {
        pushOp('&&', 2);
      } else if (s[i + 1] === '>') {
        const op = s[i + 2] === '>' ? '&>>' : '&>';
        tokens.push({ type: 'redir', op });
        i += op.length;
      } else {
        pushOp('&', 1);
      }
      continue;
    }
    if (c === '|') {
      if (s[i + 1] === '|') pushOp('||', 2);
      else if (s[i + 1] === '&') pushOp('|', 2);
      else pushOp('|', 1);
      continue;
    }
    if (c === '(' || c === ')') {
      pushOp(c, 1);
      continue;
    }
    if ((c === '<' || c === '>') && s[i + 1] === '(') {
      // Process substitution: a word whose body is examined.
      const end = matchParen(s, i + 2);
      tokens.push({ type: 'word', value: '', dynamic: true, glob: false, inner: [s.slice(i + 2, end - 1)] });
      i = end;
      continue;
    }
    if (c === '<' || c === '>') {
      const op = readRedirectOp(s, i);
      tokens.push({ type: 'redir', op });
      i += op.length;
      if (HEREDOC_REDIRECTS.has(op)) expectHeredocDelimiter = op;
      continue;
    }

    // A word.
    const word: Word = { type: 'word', value: '', dynamic: false, glob: false, inner: [] };
    let quoted = false;
    const start = i;
    while (i < s.length) {
      const ch = s[i];
      if (BLANK.has(ch) || OPERATOR_CHARS.has(ch)) {
        // A digit run directly before a redirect is a file descriptor.
        if ((ch === '>' || ch === '<') && !quoted && FD_PREFIX.test(word.value) && i > start) {
          word.value = '';
          break;
        }
        break;
      }
      if (ch === '\\') {
        if (i + 1 < s.length && s[i + 1] !== '\n') word.value += s[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") {
        const end = s.indexOf("'", i + 1);
        if (end === -1) throw new Unparseable('unterminated quote');
        word.value += s.slice(i + 1, end);
        quoted = true;
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        quoted = true;
        i += 1;
        while (true) {
          if (i >= s.length) throw new Unparseable('unterminated quote');
          const q = s[i];
          if (q === '"') {
            i += 1;
            break;
          }
          if (q === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) {
            if (s[i + 1] !== '\n') word.value += s[i + 1];
            i += 2;
            continue;
          }
          if (q === '$') {
            i = readDollar(s, i, word);
            continue;
          }
          if (q === '`') {
            const end = matchBacktick(s, i + 1);
            word.inner.push(s.slice(i + 1, end));
            word.dynamic = true;
            i = end + 1;
            continue;
          }
          word.value += q;
          i += 1;
        }
        continue;
      }
      if (ch === '$') {
        i = readDollar(s, i, word);
        continue;
      }
      if (ch === '`') {
        const end = matchBacktick(s, i + 1);
        word.inner.push(s.slice(i + 1, end));
        word.dynamic = true;
        i = end + 1;
        continue;
      }
      if (ch === '*' || ch === '?' || ch === '[') word.glob = true;
      if (ch === '~' && i === start) {
        word.value += '\u0000HOME\u0000';
        i += 1;
        continue;
      }
      word.value += ch;
      i += 1;
    }

    if (word.value === '' && !quoted && !word.dynamic && word.inner.length === 0) {
      // Only a file-descriptor prefix was read; the redirect follows.
      continue;
    }

    if (expectHeredocDelimiter) {
      pendingHeredocs.push({ delimiter: word.value, stripTabs: expectHeredocDelimiter === '<<-' });
      expectHeredocDelimiter = null;
    }
    tokens.push(word);
  }

  if (pendingHeredocs.length > 0) throw new Unparseable('unterminated heredoc');
  return tokens;
}

function readRedirectOp(s: string, i: number): string {
  const three = s.slice(i, i + 3);
  const two = s.slice(i, i + 2);
  if (three === '<<<' || three === '<<-') return three;
  if (['>>', '>|', '>&', '<<', '<>', '<&'].includes(two)) return two;
  return s[i];
}

interface SimpleCommand {
  words: Word[];
  redirects: Array<{ op: string; target: Word | null }>;
}

function splitCommands(tokens: Token[]): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], redirects: [] };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === 'op') {
      if (current.words.length > 0 || current.redirects.length > 0) commands.push(current);
      current = { words: [], redirects: [] };
      continue;
    }
    if (t.type === 'redir') {
      const next = tokens[i + 1];
      const target = next && next.type === 'word' ? next : null;
      if (target) i += 1;
      current.redirects.push({ op: t.op, target });
      continue;
    }
    current.words.push(t);
  }
  if (current.words.length > 0 || current.redirects.length > 0) commands.push(current);
  return commands;
}

/** Non-option operands, skipping the values of options that take one. */
function operands(args: Word[], optionsWithValue: ReadonlySet<string>): Word[] {
  const out: Word[] = [];
  let endOfOptions = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!endOfOptions && a.value === '--' && !a.dynamic) {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && a.value.startsWith('-') && a.value.length > 1) {
      if (optionsWithValue.has(a.value)) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

const NO_VALUE_OPTIONS = new Set<string>();
const CP_MV_VALUE_OPTIONS = new Set(['-S', '--suffix']);
const TOUCH_VALUE_OPTIONS = new Set(['-t', '-d', '-r', '--date', '--reference']);
const MKDIR_VALUE_OPTIONS = new Set(['-m', '--mode']);
const TRUNCATE_VALUE_OPTIONS = new Set(['-s', '-r', '--size', '--reference']);
const TARGET_DIRECTORY_SHORT = '-t';
const TARGET_DIRECTORY_LONG = '--target-directory';
const DD_OUTPUT = 'of=';

function cpMvTargets(args: Word[]): Word[] {
  for (let i = 0; i < args.length; i += 1) {
    const v = args[i].value;
    if ((v === TARGET_DIRECTORY_SHORT || v === TARGET_DIRECTORY_LONG) && args[i + 1]) return [args[i + 1]];
    if (v.startsWith(`${TARGET_DIRECTORY_LONG}=`)) {
      return [{ ...args[i], value: v.slice(TARGET_DIRECTORY_LONG.length + 1) }];
    }
  }
  const ops = operands(args, CP_MV_VALUE_OPTIONS);
  return ops.length > 0 ? [ops[ops.length - 1]] : [];
}

function sedTargets(args: Word[]): Word[] {
  let inPlace = false;
  let scriptGiven = false;
  const files: Word[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const v = a.value;
    if (v === '-i') {
      inPlace = true;
      // BSD sed: `-i ''` takes an empty suffix argument.
      if (args[i + 1] && args[i + 1].value === '' && !args[i + 1].dynamic) i += 1;
      continue;
    }
    if (v === '--in-place' || v.startsWith('--in-place=')) {
      inPlace = true;
      continue;
    }
    if (v === '-e' || v === '-f' || v === '--expression' || v === '--file') {
      scriptGiven = true;
      i += 1;
      continue;
    }
    if (v.startsWith('--expression=') || v.startsWith('--file=')) {
      scriptGiven = true;
      continue;
    }
    if (/^-[A-Za-z]+/.test(v) && !v.startsWith('--')) {
      if (/^-[A-Za-z]*i/.test(v)) inPlace = true;
      if (/^-e./.test(v) || /^-f./.test(v)) scriptGiven = true;
      continue;
    }
    if (v.startsWith('--')) continue;
    if (!scriptGiven) {
      scriptGiven = true;
      continue;
    }
    files.push(a);
  }
  return inPlace ? files : [];
}

/** Which arguments of a command are files it writes. Null: the command writes nothing we recognise. */
function commandTargets(name: string, args: Word[]): Word[] | null {
  switch (name) {
    case 'tee':
      return operands(args, NO_VALUE_OPTIONS);
    case 'cp':
    case 'mv':
      return cpMvTargets(args);
    case 'dd':
      return args
        .filter((a) => a.value.startsWith(DD_OUTPUT))
        .map((a) => ({ ...a, value: a.value.slice(DD_OUTPUT.length) }));
    case 'sed':
      return sedTargets(args);
    case 'touch':
      return operands(args, TOUCH_VALUE_OPTIONS);
    case 'rm':
      return operands(args, NO_VALUE_OPTIONS);
    case 'mkdir':
      return operands(args, MKDIR_VALUE_OPTIONS);
    case 'truncate':
      return operands(args, TRUNCATE_VALUE_OPTIONS);
    default:
      return null;
  }
}

const WRITE_COMMANDS = new Set(['tee', 'cp', 'mv', 'dd', 'sed', 'touch', 'rm', 'mkdir', 'truncate']);

interface Context {
  cwd: string | null;
  home: string;
  paths: string[];
}

function resolveTarget(word: Word, ctx: Context): string {
  if (word.dynamic || word.glob) throw new Unparseable('write target is not static');
  let v = word.value;
  if (v.startsWith('\u0000HOME\u0000')) {
    v = ctx.home + v.slice('\u0000HOME\u0000'.length);
  } else if (v.includes('\u0000HOME\u0000')) {
    v = v.replace('\u0000HOME\u0000', '~');
  }
  if (v.startsWith('/')) return resolve(v);
  if (ctx.cwd === null) throw new Unparseable('working directory is not static');
  return resolve(ctx.cwd, v);
}

function addPath(ctx: Context, path: string): void {
  if (!ctx.paths.includes(path)) ctx.paths.push(path);
}

function analyse(command: string, ctx: Context): void {
  for (const cmd of splitCommands(tokenize(command))) {
    for (const w of cmd.words) {
      for (const body of w.inner) analyse(body, { ...ctx, paths: ctx.paths });
    }
    for (const r of cmd.redirects) {
      if (r.target) for (const body of r.target.inner) analyse(body, { ...ctx, paths: ctx.paths });
      if (!WRITE_REDIRECTS.has(r.op)) continue;
      if (!r.target) throw new Unparseable('redirect without a target');
      if (!r.target.dynamic && DEVICE_TARGETS.has(r.target.value)) continue;
      addPath(ctx, resolveTarget(r.target, ctx));
    }

    // Strip assignments, reserved words and prefix words to find the command.
    let i = 0;
    const words = cmd.words;
    while (i < words.length) {
      const w = words[i];
      if (ASSIGNMENT.test(w.value)) {
        i += 1;
        continue;
      }
      if (!w.dynamic && RESERVED_WORDS.has(w.value)) {
        i += 1;
        continue;
      }
      if (!w.dynamic && PREFIX_WORDS.has(w.value)) {
        i += 1;
        while (i < words.length && (words[i].value.startsWith('-') || ASSIGNMENT.test(words[i].value))) i += 1;
        continue;
      }
      break;
    }
    if (i >= words.length) continue;

    const nameWord = words[i];
    const args = words.slice(i + 1);
    if (nameWord.dynamic) throw new Unparseable('command name is not static');
    const name = basename(nameWord.value);

    if (OPAQUE_COMMANDS.has(name)) throw new Unparseable(`${name} runs a command built at run time`);
    if (SHELLS.has(name) && args.some((a) => /^-[A-Za-z]*c/.test(a.value))) {
      throw new Unparseable(`${name} -c runs a command string`);
    }
    if (name === 'xargs' && args.some((a) => WRITE_COMMANDS.has(basename(a.value)))) {
      throw new Unparseable('xargs feeds a write command');
    }
    if (name === 'cd') {
      const dir = args.find((a) => !a.value.startsWith('-') || a.value === '-');
      if (!dir || dir.value === '-' || dir.dynamic || dir.glob || dir.value.startsWith('\u0000HOME\u0000')) {
        ctx.cwd = dir && dir.value.startsWith('\u0000HOME\u0000') && !dir.dynamic ? resolveTarget(dir, ctx) : null;
      } else {
        ctx.cwd = resolveTarget(dir, ctx);
      }
      continue;
    }

    const targets = commandTargets(name, args);
    if (!targets) continue;
    for (const t of targets) addPath(ctx, resolveTarget(t, ctx));
  }
}

/**
 * Name the files a Bash command writes.
 *
 * @param command - The command line from tool_input.command
 * @param cwd - The session's working directory (relative targets resolve here)
 * @param home - The home directory, for `~`
 * @returns none, absolute paths, or unknown with the reason
 */
export function detectShellWrites(command: string, cwd: string, home: string): WriteTarget {
  const ctx: Context = { cwd, home, paths: [] };
  try {
    analyse(command, ctx);
  } catch (err) {
    if (err instanceof Unparseable) return { kind: 'unknown', reason: err.message };
    return { kind: 'unknown', reason: (err as Error).message };
  }
  return ctx.paths.length > 0 ? { kind: 'paths', paths: ctx.paths } : { kind: 'none' };
}
