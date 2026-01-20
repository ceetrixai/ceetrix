/**
 * Invite code validation and waitlist signup
 * Story 265: Gate CLI installation with invite code system
 */

import { input } from '@inquirer/prompts';
import { getApiBaseUrl } from './constants.js';

/** Result of invite code validation */
interface ValidateResult {
  valid: boolean;
}

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Validate an invite code against the API.
 *
 * @param code - The invite code to validate
 * @returns Whether the code is valid
 */
export async function validateInviteCode(code: string): Promise<boolean> {
  const url = `${getApiBaseUrl()}/invite/validate`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`API error: ${response.status}`);
      return false;
    }

    const result = await response.json() as ValidateResult;
    return result.valid;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Request timed out');
    } else {
      console.error('Network error:', error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

/**
 * Submit a waitlist signup.
 *
 * @param email - User's email address
 * @param reason - Optional reason for wanting access
 * @returns Whether submission succeeded
 */
export async function submitSignup(email: string, reason?: string): Promise<boolean> {
  const url = `${getApiBaseUrl()}/signups`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, reason }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return response.ok;
  } catch (error) {
    console.error('Signup error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Run the invite code flow.
 *
 * If the user has a valid invite code, returns true and setup continues.
 * If the user doesn't have a code, prompts for waitlist signup and exits.
 *
 * @returns true if user has valid invite code, exits process otherwise
 */
export async function runInviteFlow(): Promise<boolean> {
  // Prompt for invite code
  const code = await input({
    message: 'Enter your invite code:',
    validate: (value) => {
      if (!value.trim()) {
        return 'Please enter an invite code';
      }
      return true;
    },
  });

  // Validate the code
  console.log('Validating invite code...');
  const valid = await validateInviteCode(code.trim());

  if (valid) {
    console.log('✓ Invite code accepted\n');
    return true;
  }

  // Invalid code - offer waitlist signup
  console.log('✗ Invalid invite code\n');
  console.log('Ceetrix is currently invite-only.');
  console.log('Join the waitlist to be notified when access opens up.\n');

  const email = await input({
    message: 'Email address for waitlist:',
    validate: (value) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value.trim())) {
        return 'Please enter a valid email address';
      }
      return true;
    },
  });

  const reason = await input({
    message: 'What would you use Ceetrix for? (optional):',
    default: '',
  });

  console.log('Submitting...');
  const submitted = await submitSignup(email.trim(), reason.trim() || undefined);

  if (submitted) {
    console.log('\n✓ You\'re on the waitlist!\n');
    console.log('We\'ll email you when access is available.');
    console.log('Questions? https://ceetrix.com/discord\n');
  } else {
    console.log('\n✗ Could not submit signup. Please try again later.\n');
  }

  process.exit(0);
}
