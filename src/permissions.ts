/**
 * Permission-based execution module
 *
 * Prompts user before executing any binary, making it clear:
 * - What command will be run
 * - Why it's being run
 * - All results stay local unless user chooses to share
 */

import { confirm } from '@inquirer/prompts';

/** Whether user has granted blanket trust for this session */
let sessionTrustGranted = false;

/**
 * Request permission to execute a command.
 *
 * @param command - The command that will be executed
 * @param reason - Why this command needs to run
 * @returns true if permission granted, false otherwise
 */
export async function requestPermission(
  command: string,
  reason: string
): Promise<boolean> {
  // If user already granted session trust, allow
  if (sessionTrustGranted) {
    return true;
  }

  console.log('');
  console.log(`┌─ Permission Request ─────────────────────────────────────────┐`);
  console.log(`│  Command:  ${command.slice(0, 50).padEnd(50)}│`);
  console.log(`│  Reason:   ${reason.slice(0, 50).padEnd(50)}│`);
  console.log(`│                                                              │`);
  console.log(`│  All results stay local on your machine.                     │`);
  console.log(`│  Nothing is sent externally unless you choose to share.      │`);
  console.log(`└──────────────────────────────────────────────────────────────┘`);

  const allowed = await confirm({
    message: 'Allow this command?',
    default: true,
  });

  if (!allowed) {
    return false;
  }

  // Ask if they want to trust all commands this session
  const trustAll = await confirm({
    message: 'Trust all commands for this session? (skip future prompts)',
    default: false,
  });

  if (trustAll) {
    sessionTrustGranted = true;
    console.log('Session trust granted. Future commands will run without prompts.\n');
  }

  return true;
}

/**
 * Check if session trust has been granted.
 */
export function hasSessionTrust(): boolean {
  return sessionTrustGranted;
}

/**
 * Reset session trust (for testing).
 */
export function resetSessionTrust(): void {
  sessionTrustGranted = false;
}
