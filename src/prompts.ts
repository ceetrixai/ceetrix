/**
 * Interactive prompts for user input
 */

import { input, select } from '@inquirer/prompts';

/**
 * Prompt user for repository in owner/repo format.
 *
 * @returns The repository string (e.g., "owner/repo")
 */
export async function promptForRepo(): Promise<string> {
  const repo = await input({
    message: 'Enter repository (owner/repo):',
    validate: (value) => {
      if (!value.includes('/')) {
        return 'Format: owner/repo';
      }
      if (value.split('/').length !== 2) {
        return 'Format: owner/repo';
      }
      const [owner, name] = value.split('/');
      if (!owner || !name) {
        return 'Format: owner/repo';
      }
      return true;
    },
  });
  return repo;
}

/** Actions available when Ceetrix is already configured */
export type ExistingConfigAction = 'add-repo' | 'reauth' | 'remove' | 'cancel';

/**
 * Prompt user to choose an action when Ceetrix is already configured.
 *
 * @returns The selected action
 */
export async function promptExistingConfig(): Promise<ExistingConfigAction> {
  const action = await select({
    message: 'Ceetrix is already configured. What would you like to do?',
    choices: [
      { name: 'Add another repository', value: 'add-repo' as const },
      { name: 'Re-authenticate (get new API key)', value: 'reauth' as const },
      { name: 'Remove Ceetrix', value: 'remove' as const },
      { name: 'Cancel', value: 'cancel' as const },
    ],
  });
  return action;
}

/**
 * Prompt user to confirm an action.
 *
 * @param message - The confirmation message
 * @returns true if user confirms
 */
export async function promptConfirm(message: string): Promise<boolean> {
  const response = await select({
    message,
    choices: [
      { name: 'Yes', value: true },
      { name: 'No', value: false },
    ],
  });
  return response;
}
