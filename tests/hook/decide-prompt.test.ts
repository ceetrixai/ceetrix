/**
 * What the agent is told when the developer submits a prompt.
 */
import { describe, it, expect } from 'vitest';
import { decidePrompt } from '../../src/hook/decide.js';
import { makeCache, makeBinding, recordingLog } from './helpers.js';

const { log } = recordingLog();

describe('decidePrompt', () => {
  it('bound renders title, body, scope, task forbidden and repo forbidden globs', () => {
    const text = decidePrompt(makeCache({ binding: makeBinding() }), log);
    expect(text).toBe(
      'Ceetrix task 510.2: Hook program\nBuild the hook program.\nExpected files: packages/ceetrix-cli/src/hook/**\nOff limits: secrets/**, vendor/**\nStay inside this task; complete it through Ceetrix before saying you are done.',
    );
  });

  it('bound under advise renders the same block', () => {
    const text = decidePrompt(makeCache({ strictness: 'advise', binding: makeBinding() }), log);
    expect(text).toContain('Ceetrix task 510.2: Hook program');
  });

  it('unbound enforce: bind-before-writing, next task line, recommend and wait for agreement', () => {
    const text = decidePrompt(makeCache({ strictness: 'enforce' }), log);
    expect(text).toBe(
      'No Ceetrix task is bound to this session, and this project requires one before any file is changed. Ceetrix recommends task 510.22, Recommend one next task, which builds Next task. Recommend it to the developer and start it only once they agree, or ask whether to create a story for this work.',
    );
  });

  it('unbound advise: note, next task line, may proceed outside the record', () => {
    const text = decidePrompt(makeCache({ strictness: 'advise' }), log);
    expect(text).toContain('Ceetrix recommends task 510.22');
    expect(text).toContain('you may proceed as work outside Ceetrix');
  });

  it('next task without a capability omits the clause', () => {
    const text = decidePrompt(makeCache({ next_task: { story_id: '7', seq: 1, title: 'T', capability: null } }), log);
    expect(text).toContain('Ceetrix recommends task 7.1, T.');
  });

  it('the capability clause comes from the served hook.next_task_capability key', () => {
    const text = decidePrompt(makeCache({ wording: { 'hook.next_task_capability': ' (capability: ${capability})' } }), log);
    expect(text).toContain('Ceetrix recommends task 510.22, Recommend one next task (capability: Next task).');
  });

  it('no open task renders the no-open-task variant', () => {
    const text = decidePrompt(makeCache({ next_task: null }), log)!;
    expect(text).toContain('No task is open in this project.');
    expect(text).not.toContain('recommends task');
  });

  it('none renders nothing, bound or unbound', () => {
    expect(decidePrompt(makeCache({ strictness: 'none' }), log)).toBeNull();
    expect(decidePrompt(makeCache({ strictness: 'none', binding: makeBinding() }), log)).toBeNull();
  });

  it('cache missing renders only the settings-unknown note', () => {
    expect(decidePrompt(null, log)).toBe(
      "Ceetrix could not determine this project's settings for this session, so nothing is being checked.",
    );
  });

  it('an unregistered session renders only the settings-unknown note', () => {
    expect(decidePrompt(makeCache({ registered: false, strictness: null, stale: true }), log)).toBe(
      "Ceetrix could not determine this project's settings for this session, so nothing is being checked.",
    );
  });

  it('a stale hook appends the stale note', () => {
    const text = decidePrompt(makeCache({ stale: true }), log)!;
    expect(text.split('\n').pop()).toBe(
      'This Ceetrix hook program is older than the server expects; rerun the Ceetrix setup command to update it.',
    );
  });
});
