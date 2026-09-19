/**
 * Permission-based execution module
 *
 * Single upfront permission for all CLI operations.
 * All-or-nothing: either user trusts ceetrix to run commands or exits.
 *
 * The disclosure has two parts, because setup now does two categorically
 * different things. Running commands against software the person already
 * installed is one. Fetching and executing code published by other people is
 * another, and it is not something to slip into a bullet list of `--version`
 * calls. The second block is built from what the harness modules actually
 * declare they install, so the prompt cannot drift into naming one thing while
 * the installer fetches another.
 */

import { confirm } from '@inquirer/prompts';
import { HARNESSES } from './harnesses.js';

/** Whether permission has been granted for this session */
let permissionGranted = false;

/**
 * Inner width of the permission box, in characters.
 *
 * Named because the previous version repeated the figure as a bare number in
 * every border string and in the padding call, and the longest config path
 * this file now has to print is wider than the old value. A line wider than
 * its border is a silent visual defect that no assertion catches, so the
 * width is one value and `disclosureLines` is asserted against it in tests.
 */
export const PERMISSION_BOX_WIDTH = 66;

/** Commands the CLI runs against software the person already has. */
const COMMANDS_DESCRIPTION = [
  '• which claude / codex / pi / omp / opencode / dsh',
  '• <agent> --version or --help  (confirm each is what it claims)',
  '• claude mcp list / add / remove',
  '• opencode mcp list',
  '• dsh --profile <name> --dump-config',
  '• Read/write the MCP settings of each agent you choose:',
  '    ~/.codex/config.toml',
  '    ~/.pi/agent/mcp.json',
  '    ~/.omp/agent/mcp.json',
  '    ~/.config/opencode/opencode.json',
  '    ~/.dsh/profiles/<name>/cordis.patch.yml',
  '• git rev-parse / git cat-file  (read only)',
];

/**
 * The third-party installs every harness declares.
 *
 * @returns Disclosure lines, empty when nothing would be installed
 */
function thirdPartyLines(): string[] {
  const installs = HARNESSES.flatMap((harness) => harness.installs ?? []);

  if (installs.length === 0) {
    return [];
  }

  const lines = [
    '',
    'Ceetrix will also INSTALL software published by others,',
    'but only for the agents you choose:',
  ];

  for (const install of installs) {
    lines.push(`• ${install.packageName}`);
    lines.push(`    published by ${install.publisher}`);
    lines.push(`    needed because ${install.reason}`);
  }

  return lines;
}

/**
 * Every line of the disclosure, in order.
 *
 * Exported so a test can assert none of them exceeds the box width, which is
 * otherwise a defect only a person looking at the output would notice.
 *
 * @returns The disclosure body
 */
export function disclosureLines(): string[] {
  return [...COMMANDS_DESCRIPTION, ...thirdPartyLines()];
}

/**
 * Print one line inside the box.
 *
 * @param line - Text to print
 */
function boxLine(line: string): void {
  console.log(`│  ${line.padEnd(PERMISSION_BOX_WIDTH - 2)}│`);
}

/**
 * Request upfront permission for all CLI operations.
 * Must be called once at startup. Exits if denied.
 */
export async function requestPermissionOrExit(): Promise<void> {
  if (permissionGranted) {
    return;
  }

  const border = '─'.repeat(PERMISSION_BOX_WIDTH);

  console.log('');
  console.log(`┌─ Permission Request ${border.slice(21)}┐`);
  boxLine('');
  boxLine('Ceetrix needs to run the following commands:');
  boxLine('');
  for (const line of disclosureLines()) {
    boxLine(line);
  }
  boxLine('');
  // The previous wording claimed nothing is sent externally. That stopped
  // being true the moment setup could fetch packages, and leaving it standing
  // would be telling the person something false at the exact moment they are
  // deciding whether to trust the installer.
  boxLine('Your settings stay on this machine. Installing the');
  boxLine('packages above contacts a public package registry.');
  boxLine('');
  console.log(`└${border}┘`);
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
