/**
 * Debug diagnostics for troubleshooting installation issues
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import which from 'which';

const execAsync = promisify(exec);

/** Common installation paths for Claude CLI */
const COMMON_CLAUDE_PATHS = [
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  `${process.env.HOME}/.local/bin/claude`,
];

/** Command timeout for diagnostics */
const DIAG_TIMEOUT_MS = 5000;

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

  // Try which
  try {
    const foundPath = await which('claude');
    console.log(`  which('claude'):  ${foundPath}`);
  } catch {
    console.log(`  which('claude'):  NOT FOUND`);
  }

  // Try common paths
  for (const path of COMMON_CLAUDE_PATHS) {
    try {
      await which(path);
      console.log(`  ${path}:  EXISTS`);
    } catch {
      console.log(`  ${path}:  NOT FOUND`);
    }
  }
  console.log('');

  // Claude version (if found)
  console.log('Claude CLI Version');
  console.log('──────────────────');
  try {
    const { stdout } = await execAsync('claude --version', { timeout: DIAG_TIMEOUT_MS });
    console.log(`  ${stdout.trim()}`);
  } catch {
    // Try with full path
    for (const path of COMMON_CLAUDE_PATHS) {
      try {
        const { stdout } = await execAsync(`"${path}" --version`, { timeout: DIAG_TIMEOUT_MS });
        console.log(`  ${stdout.trim()} (via ${path})`);
        break;
      } catch {
        // Continue
      }
    }
  }
  console.log('');

  // Existing MCP config
  console.log('Ceetrix MCP Config');
  console.log('──────────────────');
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
  } catch (e) {
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
  console.log('Ceetrix currently supports macOS + Claude Code only.');
  console.log('');
  console.log('If you have this combination and still have issues,');
  console.log('copy the above and post to the Ceetrix Discord:');
  console.log('https://ceetrix.com/discord');
  console.log('');
}
