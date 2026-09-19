/**
 * Debug diagnostics for troubleshooting installation issues
 *
 * Note: --debug mode runs without permission prompt since it's
 * explicitly invoked by the user for diagnostic purposes.
 *
 * The per-harness sections come from each harness's own diagnose(). Before
 * that they were two hand-written blocks here, which carried their own copies
 * of COMMON_CLAUDE_PATHS and of the version-parsing helpers; the design record
 * notes that the path copy had already drifted out of step with the real one
 * (docs/design/ceetrix-v2.md:701). Six harnesses' worth of that duplication is
 * not worth keeping, and a harness added to the registry now appears here
 * automatically rather than being silently missing.
 */

import { HARNESSES } from './harnesses.js';
import { MIN_CLAUDE_VERSION, COMMON_CLAUDE_PATHS } from './claude.js';

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

  // Per-harness diagnostics, straight from the registry.
  for (const harness of HARNESSES) {
    console.log(harness.label);
    console.log('─'.repeat(harness.label.length));
    try {
      for (const line of await harness.diagnose()) {
        console.log(`  ${line}`);
      }
    } catch (error) {
      // A harness whose diagnostics throw must not take the whole report with
      // it — the report exists precisely for machines where something is wrong.
      console.log(`  diagnostics failed: ${(error as Error).message}`);
    }
    console.log('');
  }

  // Claude Code carries a minimum version and a fallback path list that the
  // troubleshooting runbook refers to by name, so both are printed in full.
  console.log('Claude Code fallback paths');
  console.log('──────────────────────────');
  console.log(
    `  Min version:  v${MIN_CLAUDE_VERSION.major}.${MIN_CLAUDE_VERSION.minor} (for HTTP transport)`
  );
  for (const path of COMMON_CLAUDE_PATHS) {
    console.log(`  ${path}`);
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
  console.log(
    `Ceetrix supports macOS and Linux with: ${HARNESSES.map((h) => h.label).join(', ')}.`
  );
  console.log('');
  console.log('If you have issues, copy the above and post to the');
  console.log('Ceetrix Discord: https://ceetrix.com/discord');
  console.log('');
}
