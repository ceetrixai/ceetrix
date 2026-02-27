/**
 * Interactive prompts for user input
 */

import { input, select, checkbox } from '@inquirer/prompts';
import type { AgentStatus } from './config.js';

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

/** Supported agent types */
export type AgentType = 'claude' | 'codex';

/** Display labels for each agent type */
const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex CLI',
};

/**
 * Wizard-style prompt for incremental agent configuration.
 *
 * Shows all detected agents with their config status. Already-configured
 * agents appear disabled. Unconfigured agents are pre-checked.
 *
 * Auto-selects when exactly one unconfigured agent is detected and no
 * others are present (skip the prompt entirely).
 *
 * @param statuses - Per-agent detection and configuration status
 * @returns Array of agent types selected for configuration (may be empty)
 */
export async function promptAgentWizard(
  statuses: Record<AgentType, AgentStatus>,
): Promise<AgentType[]> {
  const detected = (Object.entries(statuses) as [AgentType, AgentStatus][])
    .filter(([, s]) => s.detected);

  if (detected.length === 0) return [];

  const unconfigured = detected.filter(([, s]) => !s.configured);

  // Single unconfigured agent, no other agents detected → auto-select
  if (unconfigured.length === detected.length && detected.length === 1) {
    return [detected[0][0]];
  }

  const choices = detected.map(([agent, status]) => ({
    name: status.configured
      ? `${AGENT_LABELS[agent]} (configured)`
      : AGENT_LABELS[agent],
    value: agent,
    checked: !status.configured,
    disabled: status.configured ? '(already configured)' as const : false as const,
  }));

  const selected = await checkbox({
    message: 'Which agents should Ceetrix be configured for?',
    choices,
  });

  return selected;
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
