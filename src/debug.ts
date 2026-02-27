/**
 * Debug diagnostics for troubleshooting installation issues
 *
 * Note: --debug mode runs without permission prompt since it's
 * explicitly invoked by the user for diagnostic purposes.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import which from 'which';
import {
  CODEX_CONFIG_DIR,
  CODEX_CONFIG_FILE,
  CODEX_API_KEY_ENV_VAR,
  CODEX_VERSION_MARKER,
  CODEX_VERSION_CHECK_TIMEOUT_MS,
  COMMON_CODEX_PATHS,
} from './constants.js';

const execAsync = promisify(exec);

/** Common installation paths for Claude CLI */
const COMMON_CLAUDE_PATHS = [
  '/opt/homebrew/bin/claude', // macOS Homebrew ARM
  '/usr/local/bin/claude', // macOS Homebrew Intel / Linux
  '/usr/bin/claude', // Linux system package
  '/snap/bin/claude', // Linux Snap package
  `${process.env.HOME}/.local/bin/claude`, // pip/pipx style installs
];

/** Command timeout for diagnostics */
const DIAG_TIMEOUT_MS = 5000;

/** Short timeout for version verification */
const VERSION_CHECK_TIMEOUT_MS = 3000;

/** Expected marker in Claude Code version output */
const CLAUDE_CODE_MARKER = 'Claude Code';

/** Minimum required Claude CLI version */
const MIN_VERSION = { major: 2, minor: 0 };

/**
 * Print debug diagnostics and exit.
 */
export async function printDebugInfo(): Promise<void> {
  console.log('\nCeetrix Debug Diagnostics');
  console.log('═════════════════════════\n');

  // Platform info
  console.log('Platform');
  console.log('────────');
  console.log(`  OS:           ${process.platform}`);
  console.log(`  Arch:         ${process.arch}`);
  console.log(`  Node:         ${process.version}`);
  console.log('');

  // PATH
  console.log('PATH');
  console.log('────');
  const pathDirs = (process.env.PATH || '').split(':');
  for (const dir of pathDirs) {
    console.log(`  ${dir}`);
  }
  console.log('');

  // Claude CLI detection
  console.log('Claude CLI Detection');
  console.log('────────────────────');
  console.log(`  Min required:     v${MIN_VERSION.major}.${MIN_VERSION.minor} (for HTTP transport)`);

  // Helper to parse version string
  function parseVersion(versionOutput: string): { major: number; minor: number } | null {
    const match = versionOutput.match(/^(\d+)\.(\d+)\./);
    if (!match) return null;
    return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
  }

  // Helper to check if version meets minimum
  function meetsMinVersion(v: { major: number; minor: number }): boolean {
    if (v.major > MIN_VERSION.major) return true;
    if (v.major < MIN_VERSION.major) return false;
    return v.minor >= MIN_VERSION.minor;
  }

  // Helper to check if path is real Claude Code
  async function checkClaudeCode(path: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`"${path}" --version`, {
        timeout: VERSION_CHECK_TIMEOUT_MS,
      });
      if (stdout.includes(CLAUDE_CODE_MARKER)) {
        const version = parseVersion(stdout);
        if (version && meetsMinVersion(version)) {
          return `✓ Claude Code v${version.major}.${version.minor} (meets min)`;
        } else if (version) {
          return `✗ Claude Code v${version.major}.${version.minor} (BELOW MIN - update required)`;
        }
        return `✓ Claude Code (${stdout.trim()})`;
      }
      return `✗ NOT Claude Code (responds: ${stdout.trim().slice(0, 40)})`;
    } catch (e) {
      const err = e as { killed?: boolean; code?: string };
      if (err.killed) return '✗ TIMEOUT (possibly stale install)';
      return '✗ NOT FOUND or ERROR';
    }
  }

  // Try which
  let whichPath: string | null = null;
  try {
    whichPath = await which('claude');
    const status = await checkClaudeCode(whichPath);
    console.log(`  which('claude'):  ${whichPath}`);
    console.log(`                    ${status}`);
  } catch {
    console.log(`  which('claude'):  NOT IN PATH`);
  }

  // Try common paths
  for (const path of COMMON_CLAUDE_PATHS) {
    if (path === whichPath) continue; // Already checked
    const status = await checkClaudeCode(path);
    console.log(`  ${path}:`);
    console.log(`                    ${status}`);
  }
  console.log('');

  // Codex CLI detection
  console.log('Codex CLI Detection');
  console.log('───────────────────');

  async function checkCodexVersion(path: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`"${path}" --version`, {
        timeout: CODEX_VERSION_CHECK_TIMEOUT_MS,
      });
      if (stdout.toLowerCase().includes(CODEX_VERSION_MARKER)) {
        return `✓ Codex CLI (${stdout.trim()})`;
      }
      return `✗ NOT Codex CLI (responds: ${stdout.trim().slice(0, 40)})`;
    } catch (e) {
      const err = e as { killed?: boolean };
      if (err.killed) return '✗ TIMEOUT';
      return '✗ NOT FOUND or ERROR';
    }
  }

  let codexWhichPath: string | null = null;
  try {
    codexWhichPath = await which('codex');
    const status = await checkCodexVersion(codexWhichPath);
    console.log(`  which('codex'):   ${codexWhichPath}`);
    console.log(`                    ${status}`);
  } catch {
    console.log(`  which('codex'):   NOT IN PATH`);
  }

  for (const path of COMMON_CODEX_PATHS) {
    if (path === codexWhichPath) continue;
    const status = await checkCodexVersion(path);
    console.log(`  ${path}:`);
    console.log(`                    ${status}`);
  }

  // Codex config file
  const codexConfigPath = join(homedir(), CODEX_CONFIG_DIR, CODEX_CONFIG_FILE);
  console.log(`  Config file:      ${codexConfigPath}`);
  try {
    const content = await readFile(codexConfigPath, 'utf-8');
    if (content.includes('ceetrix')) {
      console.log('  Ceetrix entry:    CONFIGURED');
    } else {
      console.log('  Ceetrix entry:    NOT CONFIGURED');
    }
  } catch {
    console.log('  Ceetrix entry:    FILE NOT FOUND');
  }
  console.log(`  ${CODEX_API_KEY_ENV_VAR}:  ${process.env[CODEX_API_KEY_ENV_VAR] ? 'SET' : 'NOT SET'}`);
  console.log('');

  // Existing MCP config (Claude)
  console.log('Ceetrix MCP Config (Claude)');
  console.log('───────────────────────────');
  try {
    const { stdout } = await execAsync('claude mcp list', { timeout: DIAG_TIMEOUT_MS });
    if (stdout.includes('ceetrix:')) {
      const lines = stdout.split('\n');
      const ceetrixLine = lines.find(l => l.includes('ceetrix'));
      console.log(`  Status:  CONFIGURED`);
      if (ceetrixLine) {
        console.log(`  Entry:   ${ceetrixLine.trim()}`);
      }
    } else {
      console.log(`  Status:  NOT CONFIGURED`);
    }
  } catch {
    console.log(`  Status:  UNABLE TO CHECK (claude mcp list failed)`);
  }
  console.log('');

  // Shell info
  console.log('Shell Environment');
  console.log('─────────────────');
  console.log(`  SHELL:        ${process.env.SHELL || 'not set'}`);
  console.log(`  HOME:         ${process.env.HOME || 'not set'}`);
  console.log(`  USER:         ${process.env.USER || 'not set'}`);
  console.log('');

  console.log('─────────────────────────────────────────────────────');
  console.log('Ceetrix supports macOS and Linux with Claude Code and Codex CLI.');
  console.log('');
  console.log('If you have issues, copy the above and post to the');
  console.log('Ceetrix Discord: https://ceetrix.com/discord');
  console.log('');
}
