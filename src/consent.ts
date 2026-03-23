/**
 * T&C consent prompt for CLI setup flow (Story 463)
 *
 * Displays a boxed consent prompt with links to the Terms of Service
 * and Privacy Policy. Must be accepted before setup can proceed.
 */

import { confirm } from '@inquirer/prompts';

/** Current terms version — must match server-side CURRENT_TERMS_VERSION */
export const CURRENT_TERMS_VERSION = '2026-03-23';

/** Marketing site base URL for legal pages */
const LEGAL_BASE_URL = 'https://ceetrix.com';

/**
 * Display the T&C consent prompt and require explicit agreement.
 * Exits the process if the user declines.
 *
 * @returns true if accepted (never returns false — exits on decline)
 */
export async function requestConsentOrExit(): Promise<void> {
  console.log('');
  console.log('┌─ Terms of Service & Privacy Policy ─────────────────────────┐');
  console.log('│                                                              │');
  console.log('│  By continuing, you agree to:                               │');
  console.log('│                                                              │');
  console.log(`│  • Terms of Service                                         │`);
  console.log(`│    ${(LEGAL_BASE_URL + '/tos').padEnd(56)}│`);
  console.log('│                                                              │');
  console.log(`│  • Privacy Policy                                           │`);
  console.log(`│    ${(LEGAL_BASE_URL + '/privacy').padEnd(56)}│`);
  console.log('│                                                              │');
  console.log('│  Your specifications are processed by Google Gemini.        │');
  console.log('│  See Privacy Policy for details.                            │');
  console.log('│                                                              │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');

  const agreed = await confirm({
    message: 'Do you agree to the Terms of Service and Privacy Policy?',
    default: true,
  });

  if (!agreed) {
    console.log('\nYou must agree to the Terms of Service and Privacy Policy to use Ceetrix.\n');
    process.exit(0);
  }
}
