/**
 * Tests for Claude CLI detection and verification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Expected marker in Claude Code version output */
const CLAUDE_CODE_VERSION_MARKER = 'Claude Code';

/** Version check timeout */
const VERSION_CHECK_TIMEOUT_MS = 3000;

describe('Claude Code version marker', () => {
  it('marker constant is correct', () => {
    expect(CLAUDE_CODE_VERSION_MARKER).toBe('Claude Code');
  });

  it('detects Claude Code in version string', () => {
    const validOutput = '2.0.76 (Claude Code)';
    expect(validOutput.includes(CLAUDE_CODE_VERSION_MARKER)).toBe(true);
  });

  it('rejects output without Claude Code marker', () => {
    const invalidOutput = 'Some Other Tool v1.0.0';
    expect(invalidOutput.includes(CLAUDE_CODE_VERSION_MARKER)).toBe(false);
  });

  it('rejects empty output', () => {
    const emptyOutput = '';
    expect(emptyOutput.includes(CLAUDE_CODE_VERSION_MARKER)).toBe(false);
  });

  it('rejects partial matches', () => {
    const partialMatch = 'Claude v1.0';
    expect(partialMatch.includes(CLAUDE_CODE_VERSION_MARKER)).toBe(false);
  });
});

describe('common Claude paths', () => {
  const COMMON_CLAUDE_PATHS = [
    '/opt/homebrew/bin/claude', // macOS Homebrew ARM
    '/usr/local/bin/claude', // macOS Homebrew Intel / Linux
    '/usr/bin/claude', // Linux system package
    '/snap/bin/claude', // Linux Snap package
    `${process.env.HOME}/.local/bin/claude`, // pip/pipx style installs
  ];

  it('includes Homebrew ARM path', () => {
    expect(COMMON_CLAUDE_PATHS).toContain('/opt/homebrew/bin/claude');
  });

  it('includes Homebrew Intel path', () => {
    expect(COMMON_CLAUDE_PATHS).toContain('/usr/local/bin/claude');
  });

  it('includes local bin path', () => {
    expect(COMMON_CLAUDE_PATHS).toContain(`${process.env.HOME}/.local/bin/claude`);
  });

  it('includes Linux system package path', () => {
    expect(COMMON_CLAUDE_PATHS).toContain('/usr/bin/claude');
  });

  it('includes Linux Snap path', () => {
    expect(COMMON_CLAUDE_PATHS).toContain('/snap/bin/claude');
  });

  it('has exactly 5 fallback paths', () => {
    expect(COMMON_CLAUDE_PATHS).toHaveLength(5);
  });
});

describe('version check timeout', () => {
  it('timeout is 3 seconds', () => {
    expect(VERSION_CHECK_TIMEOUT_MS).toBe(3000);
  });

  it('timeout is reasonable for hanging processes', () => {
    // Should be long enough for slow responses but short enough to fail fast
    expect(VERSION_CHECK_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(VERSION_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

describe('isClaudeCode verification logic', () => {
  // Mock the verification function behavior
  async function isClaudeCode(path: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`"${path}" --version`, {
        timeout: VERSION_CHECK_TIMEOUT_MS,
      });
      return stdout.includes(CLAUDE_CODE_VERSION_MARKER);
    } catch {
      return false;
    }
  }

  it('returns false for non-existent path', async () => {
    const result = await isClaudeCode('/nonexistent/path/to/claude');
    expect(result).toBe(false);
  });

  it('returns false for path that is not executable', async () => {
    const result = await isClaudeCode('/etc/passwd');
    expect(result).toBe(false);
  });
});

describe('candidate ordering', () => {
  it('which result should be checked first', () => {
    // The implementation checks which() result before fallback paths
    const candidates: string[] = [];

    // Simulate which finding something
    const whichResult = '/some/path/claude';
    candidates.push(whichResult);

    // Add fallback paths
    const fallbacks = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
    candidates.push(...fallbacks);

    expect(candidates[0]).toBe(whichResult);
    expect(candidates.indexOf(whichResult)).toBe(0);
  });
});
