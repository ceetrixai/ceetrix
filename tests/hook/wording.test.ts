/**
 * Wording: server-served templates with compiled-in defaults. A message is
 * never blank, and every fallback to a default is logged.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_WORDING, WORDING_KEYS, renderWording } from '../../src/hook/wording.js';
import { recordingLog } from './helpers.js';

/** Every key the contract names. */
const CONTRACT_KEYS = [
  'hook.prompt.bound',
  'hook.prompt.unbound_enforce',
  'hook.prompt.unbound_advise',
  'hook.prompt.settings_unknown',
  'hook.prompt.stale',
  'hook.next_task_line',
  'hook.next_task_capability',
  'hook.next_task_none',
  'hook.deny.no_task',
  'hook.deny.outside_scope',
  'hook.deny.forbidden',
  'hook.deny.ceetrix_dir',
  'hook.deny.unknown_target',
  'hook.deny.policy_invalid',
  'hook.warn.prefix',
  'hook.hold.turn_end',
  'hook.reminder.unbound',
];

describe('defaults', () => {
  it('has a non-blank default for every contract key', () => {
    for (const key of CONTRACT_KEYS) {
      expect(WORDING_KEYS).toContain(key);
      expect(DEFAULT_WORDING[key as keyof typeof DEFAULT_WORDING].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('renderWording', () => {
  it('uses the served template and substitutes ${var}', () => {
    const { log, lines } = recordingLog();
    const out = renderWording({ 'hook.deny.ceetrix_dir': 'no: ${path} [${strictness}]' }, 'hook.deny.ceetrix_dir', { path: 'a', strictness: 'enforce' }, log);
    expect(out).toBe('no: a [enforce]');
    expect(lines).toEqual([]);
  });

  it('a missing key falls back to the default and logs the fallback', () => {
    const { log, lines } = recordingLog();
    const out = renderWording({}, 'hook.deny.ceetrix_dir', { path: '.ceetrix/x', strictness: 'enforce' }, log);
    expect(out).toBe('[enforce] .ceetrix/x is inside Ceetrix\'s own project files. Use the Ceetrix tools instead of editing these files.');
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/hook\.deny\.ceetrix_dir/);
  });

  it('a blank served template falls back to the default, never blank', () => {
    const { log, lines } = recordingLog();
    const out = renderWording({ 'hook.prompt.stale': '   ' }, 'hook.prompt.stale', {}, log);
    expect(out).toBe(DEFAULT_WORDING['hook.prompt.stale']);
    expect(lines.length).toBe(1);
  });

  it('a served template that renders blank falls back to the default', () => {
    const { log } = recordingLog();
    const out = renderWording({ 'hook.prompt.stale': '${nothing}' }, 'hook.prompt.stale', {}, log);
    expect(out).toBe(DEFAULT_WORDING['hook.prompt.stale']);
  });

  it('a null wording map falls back', () => {
    const { log } = recordingLog();
    expect(renderWording(null, 'hook.next_task_none', {}, log)).toBe('No task is open in this project.');
  });

  it('an unknown variable renders empty, not as ${name}', () => {
    const { log } = recordingLog();
    expect(renderWording({ 'hook.next_task_none': 'a${x}b' }, 'hook.next_task_none', {}, log)).toBe('ab');
  });
});
