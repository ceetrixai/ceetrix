/**
 * Permission-based execution module
 *
 * Single upfront permission for all CLI operations.
 * All-or-nothing: either user trusts ceetrix to run commands or exits.
 */

import { confirm } from '@inquirer/prompts';

/** Whether permission has been granted for this session */
let permissionGranted = false;

/** Commands that will be executed */
const COMMANDS_DESCRIPTION = `
• which claude / codex  (find CLI locations)
• claude --version      (verify Claude Code)
• codex --version       (verify Codex CLI)
• claude mcp list       (check existing Claude config)
• claude mcp add        (add Ceetrix to Claude)
• claude mcp remove     (if reconfiguring Claude)
• Read/write ~/.codex/config.toml (Codex config)
`;

/**
 * Request upfront permission for all CLI operations.
 * Must be called once at startup. Exits if denied.
 */
export async function requestPermissionOrExit(): Promise<void> {
  if (permissionGranted) {
    return;
  }

  console.log('');
  console.log('┌─ Permission Request ─────────────────────────────────────────┐');
  console.log('│                                                              │');
  console.log('│  Ceetrix needs to run the following commands:                │');
  console.log('│                                                              │');
  for (const line of COMMANDS_DESCRIPTION.trim().split('\n')) {
    console.log(`│  ${line.padEnd(58)}│`);
  }
  console.log('│                                                              │');
  console.log('│  All results stay local on your machine.                     │');
  console.log('│  Nothing is sent externally unless you choose to share.      │');
  console.log('│                                                              │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');

  const allowed = await confirm({
    message: 'Allow Ceetrix to run these commands?',
    default: true,
  });

  if (!allowed) {
    console.log('\nPermission denied. Exiting.\n');
    process.exit(0);
  }

  permissionGranted = true;
}

/**
 * Check if permission has been granted.
 * For internal use by other modules.
 */
export function hasPermission(): boolean {
  return permissionGranted;
}

/**
 * Reset permission state (for testing).
 */
export function resetPermission(): void {
  permissionGranted = false;
}
