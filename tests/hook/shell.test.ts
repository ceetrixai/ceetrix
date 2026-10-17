/**
 * Layer 1 write-effect detection for Bash commands.
 *
 * Three equivalence classes: no write detected, writes to known paths, and
 * writes that cannot be determined. "Unknown" is never folded into "none":
 * a command whose target cannot be read must not pass as one that writes
 * nothing.
 */
import { describe, it, expect } from 'vitest';
import { detectShellWrites } from '../../src/hook/shell.js';

const CWD = '/home/dev/repo';
const HOME = '/home/dev';

function paths(command: string): string[] {
  const r = detectShellWrites(command, CWD, HOME);
  if (r.kind !== 'paths') throw new Error(`expected paths for ${command}, got ${JSON.stringify(r)}`);
  return r.paths;
}

function kind(command: string): string {
  return detectShellWrites(command, CWD, HOME).kind;
}

describe('no write detected', () => {
  it.each([
    'ls -la',
    'git status',
    'cat a.txt | grep x',
    'echo hi',
    'bunx vitest run',
    'echo $(date)',
    'grep -r "a > b" src',
    "echo 'x > y'",
    'cmd 2>&1',
    'cmd >&2',
    'cat < input.txt',
  ])('%s', (command) => {
    expect(kind(command)).toBe('none');
  });

  it('a redirect to /dev/null is ignored', () => {
    expect(kind('cmd > /dev/null 2>&1')).toBe('none');
    expect(kind('cmd 2>/dev/null')).toBe('none');
    expect(kind('cmd &>/dev/null')).toBe('none');
  });
});

describe('redirections', () => {
  it('> and >> name their target, resolved against cwd', () => {
    expect(paths('echo x > out.txt')).toEqual(['/home/dev/repo/out.txt']);
    expect(paths('echo x >> /tmp/log')).toEqual(['/tmp/log']);
    expect(paths('echo x>out.txt')).toEqual(['/home/dev/repo/out.txt']);
    expect(paths('cmd 2> err.log')).toEqual(['/home/dev/repo/err.log']);
    expect(paths('cmd &> all.log')).toEqual(['/home/dev/repo/all.log']);
  });

  it('a quoted target is unquoted', () => {
    expect(paths('echo x > "a b.txt"')).toEqual(['/home/dev/repo/a b.txt']);
  });

  it('~ expands to the home directory', () => {
    expect(paths('echo x > ~/notes.txt')).toEqual(['/home/dev/notes.txt']);
  });

  it('a redirect into the .ceetrix directory is reported', () => {
    expect(paths('echo x > .ceetrix/policy.yaml')).toEqual(['/home/dev/repo/.ceetrix/policy.yaml']);
  });

  it('a heredoc body is not parsed as commands', () => {
    const cmd = "cat > a.txt <<'EOF'\nrm -rf everything > b.txt\nEOF\necho done";
    expect(paths(cmd)).toEqual(['/home/dev/repo/a.txt']);
  });
});

describe('write commands', () => {
  it('tee, with or without -a, names every file', () => {
    expect(paths('echo x | tee a.txt b.txt')).toEqual(['/home/dev/repo/a.txt', '/home/dev/repo/b.txt']);
    expect(paths('echo x | tee -a .ceetrix/x')).toEqual(['/home/dev/repo/.ceetrix/x']);
  });

  it('cp and mv name their last argument', () => {
    expect(paths('cp a.txt b.txt')).toEqual(['/home/dev/repo/b.txt']);
    expect(paths('cp -r src dest/')).toEqual(['/home/dev/repo/dest']);
    expect(paths('mv a.txt /tmp/b.txt')).toEqual(['/tmp/b.txt']);
    expect(paths('cp -t target a b')).toEqual(['/home/dev/repo/target']);
  });

  it('dd names of=', () => {
    expect(paths('dd if=/dev/zero of=disk.img bs=1M count=1')).toEqual(['/home/dev/repo/disk.img']);
  });

  it('sed -i names its file arguments, GNU and BSD forms', () => {
    expect(paths("sed -i 's/a/b/' x.ts y.ts")).toEqual(['/home/dev/repo/x.ts', '/home/dev/repo/y.ts']);
    expect(paths("sed -i '' 's/a/b/' x.ts")).toEqual(['/home/dev/repo/x.ts']);
    expect(paths("sed -i.bak -e 's/a/b/' x.ts")).toEqual(['/home/dev/repo/x.ts']);
  });

  it('sed without -i writes nothing', () => {
    expect(kind("sed 's/a/b/' x.ts")).toBe('none');
  });

  it('touch, rm, mkdir and truncate name their operands', () => {
    expect(paths('touch a b')).toEqual(['/home/dev/repo/a', '/home/dev/repo/b']);
    expect(paths('rm -rf build')).toEqual(['/home/dev/repo/build']);
    expect(paths('mkdir -p a/b')).toEqual(['/home/dev/repo/a/b']);
    expect(paths('truncate -s 0 log.txt')).toEqual(['/home/dev/repo/log.txt']);
  });

  it('commands after && and ; are each examined', () => {
    expect(paths('ls && touch a; echo x > b')).toEqual(['/home/dev/repo/a', '/home/dev/repo/b']);
  });

  it('cd with a literal directory changes where later relative targets resolve', () => {
    expect(paths('cd sub && touch a')).toEqual(['/home/dev/repo/sub/a']);
  });

  it('env assignments and sudo before a write command are skipped', () => {
    expect(paths('FOO=1 sudo touch a')).toEqual(['/home/dev/repo/a']);
  });
});

describe('unknown targets', () => {
  it.each([
    'eval "echo x > a"',
    'echo x > $(pick)',
    'echo x > "$OUT"',
    'touch `name`',
    'bash -c "touch a"',
    'sh -c "echo > x"',
    'echo "unterminated',
    'rm *.log',
    'cd "$DIR" && touch a',
  ])('%s', (command) => {
    expect(kind(command)).toBe('unknown');
  });

  it('a write inside a command substitution is still seen', () => {
    expect(paths('echo $(touch inner)')).toEqual(['/home/dev/repo/inner']);
  });
});
