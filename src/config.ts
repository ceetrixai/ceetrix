/**
 * Configuration management for existing Ceetrix setup
 *
 * Checks and manages Ceetrix config across supported agents.
 */

import { checkClaudeCli, checkExistingConfig as checkClaudeConfig, removeConfig as removeClaudeConfig } from './claude.js';
import { isCodexAvailable, checkExistingConfig as checkCodexConfig, removeConfig as removeCodexConfig } from './codex.js';
import type { AgentType } from './prompts.js';

/** Per-agent detection and configuration status */
export interface AgentStatus {
  detected: boolean;
  configured: boolean;
}

/**
 * Get detection and configuration status for all supported agents.
 *
 * Runs all checks in parallel for speed.
 *
 * @returns Per-agent status map
 */
export async function getAgentStatuses(): Promise<Record<AgentType, AgentStatus>> {
  const [claudeDetected, codexDetected, claudeConfigured, codexConfigured] = await Promise.all([
    checkClaudeCli(),
    isCodexAvailable(),
    checkClaudeConfig(),
    checkCodexConfig(),
  ]);
  return {
    claude: { detected: claudeDetected, configured: claudeConfigured },
    codex: { detected: codexDetected, configured: codexConfigured },
  };
}

/**
 * Check if Ceetrix is already configured in any supported agent.
 *
 * @returns true if ceetrix is configured in Claude Code or Codex CLI
 */
export async function checkExistingConfig(): Promise<boolean> {
  const [claude, codex] = await Promise.all([
    checkClaudeConfig(),
    checkCodexConfig(),
  ]);
  return claude || codex;
}

/**
 * Remove existing Ceetrix configuration from all supported agents.
 *
 * @throws Error if removal fails
 */
export async function removeExistingConfig(): Promise<void> {
  await Promise.all([
    removeClaudeConfig(),
    removeCodexConfig(),
  ]);
}
