/**
 * Contract tests for the harness registry.
 *
 * The registry exists so that adding a coding agent is one module plus one
 * array entry, rather than six edits across four files, two of which used to
 * fail silently when missed. These tests hold that guarantee: an entry that
 * does not implement the whole contract, or that collides with another, is
 * caught here rather than by a person discovering their agent was quietly
 * skipped.
 */

import { describe, it, expect } from 'vitest';
import { HARNESSES, getHarness, type AgentType } from '../src/harnesses.js';

/** Every method the contract requires of a harness. */
const REQUIRED_METHODS = [
  'detect',
  'isConfigured',
  'add',
  'remove',
  'restartNotice',
  'diagnose',
  'resetCache',
] as const;

/** Every readonly field the contract requires. */
const REQUIRED_FIELDS = ['id', 'label', 'homepage'] as const;

describe('registry contents', () => {
  it('holds every harness this build claims to support', () => {
    expect(HARNESSES.map((h) => h.id).sort()).toEqual([
      'claude',
      'codex',
      'dsh',
      'omp',
      'opencode',
      'pi',
    ]);
  });

  it('gives every harness a unique identifier', () => {
    const ids = HARNESSES.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every harness a distinct label, since the wizard lists them', () => {
    const labels = HARNESSES.map((h) => h.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every harness somewhere to obtain it, for the not-found message', () => {
    for (const harness of HARNESSES) {
      expect(harness.homepage, harness.id).toMatch(/^https:\/\//);
    }
  });
});

describe('registry contract', () => {
  it.each(REQUIRED_METHODS)('every harness implements %s', (method) => {
    for (const harness of HARNESSES) {
      expect(typeof harness[method], `${harness.id}.${method}`).toBe('function');
    }
  });

  it.each(REQUIRED_FIELDS)('every harness declares %s', (field) => {
    for (const harness of HARNESSES) {
      expect(typeof harness[field], `${harness.id}.${field}`).toBe('string');
      expect(harness[field].length, `${harness.id}.${field}`).toBeGreaterThan(0);
    }
  });

  it('every restart notice names the agent and tells the person to restart', () => {
    for (const harness of HARNESSES) {
      const notice = harness.restartNotice();
      // An MCP server that is registered but whose host has not restarted is
      // the single most common "it did not work" report, so every harness has
      // to say this.
      expect(notice.title, harness.id).toContain('Restart');
      expect(notice.lines.length, harness.id).toBeGreaterThan(0);
    }
  });

  it('declares third-party installs only where there are any', () => {
    const withInstalls = HARNESSES.filter((h) => (h.installs ?? []).length > 0).map((h) => h.id);

    // pi has no MCP at all; dsh has no built-in client. The other four need
    // nothing installed, and silently gaining an install would escape the
    // consent prompt, so the set is pinned.
    expect(withInstalls.sort()).toEqual(['dsh', 'pi']);
  });

  it('names a publisher and a reason for everything it would install', () => {
    for (const install of HARNESSES.flatMap((h) => h.installs ?? [])) {
      expect(install.packageName.length).toBeGreaterThan(0);
      expect(install.publisher.length).toBeGreaterThan(0);
      expect(install.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('getHarness', () => {
  it('finds every registered harness by its identifier', () => {
    for (const harness of HARNESSES) {
      expect(getHarness(harness.id as AgentType)).toBe(harness);
    }
  });

  it('returns nothing for an identifier that is not registered', () => {
    expect(getHarness('not-a-harness' as AgentType)).toBeUndefined();
  });
});
