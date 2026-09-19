/**
 * Configuration status and removal across every supported coding agent.
 *
 * All three operations iterate the registry. Before that they were three
 * separate hand-written parallel fan-outs, each naming the two harnesses
 * again, so adding a harness meant remembering all three.
 */

import { HARNESSES, type AgentType } from './harnesses.js';

/** Per-agent detection and configuration status */
export interface AgentStatus {
  detected: boolean;
  configured: boolean;
}

/**
 * Get detection and configuration status for all supported agents.
 *
 * Every probe runs in parallel, as before. Detection and the configured check
 * stay independent of each other: a harness reports its configuration from
 * its own settings whether or not the program is installed, which is the
 * existing behaviour the all-configured branch of setup depends on.
 *
 * @returns Per-agent status map
 */
export async function getAgentStatuses(): Promise<Record<AgentType, AgentStatus>> {
  const entries = await Promise.all(
    HARNESSES.map(async (harness) => {
      const [detected, configured] = await Promise.all([
        harness.detect(),
        harness.isConfigured(),
      ]);
      return [harness.id, { detected, configured }] as const;
    })
  );

  return Object.fromEntries(entries) as Record<AgentType, AgentStatus>;
}

/**
 * Check if Ceetrix is already configured in any supported agent.
 *
 * @returns true if ceetrix is configured in at least one agent
 */
export async function checkExistingConfig(): Promise<boolean> {
  const configured = await Promise.all(HARNESSES.map((harness) => harness.isConfigured()));
  return configured.some(Boolean);
}

/**
 * Remove existing Ceetrix configuration from all supported agents.
 *
 * One agent failing does not prevent the others being cleaned up: a partial
 * removal that stops at the first error would leave Ceetrix registered
 * somewhere the person believes they removed it from. Failures are collected
 * and reported together.
 *
 * @throws Error naming every agent that could not be cleaned up
 */
export async function removeExistingConfig(): Promise<void> {
  const results = await Promise.allSettled(HARNESSES.map((harness) => harness.remove()));

  const failures = results
    .map((result, index) => ({ result, harness: HARNESSES[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, harness }) => {
      const reason = (result as PromiseRejectedResult).reason as Error;
      return `${harness.label}: ${reason?.message ?? String(reason)}`;
    });

  if (failures.length > 0) {
    throw new Error(`Could not remove Ceetrix from:\n  ${failures.join('\n  ')}`);
  }
}
