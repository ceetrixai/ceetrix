/**
 * Turn end: hold the turn once when a bound task is not complete.
 */
import { describe, it, expect, vi } from 'vitest';
import { decideTurnEnd, decidePostTool, type TaskStatusResult } from '../../src/hook/decide.js';
import { makeCache, makeBinding, recordingLog } from './helpers.js';

const { log } = recordingLog();
const notDone = async (): Promise<TaskStatusResult> => ({ kind: 'status', status: 'in-progress' });

describe('decideTurnEnd', () => {
  it('none allows without asking the server', async () => {
    const fetchStatus = vi.fn(notDone);
    const d = await decideTurnEnd({ cache: makeCache({ strictness: 'none', binding: makeBinding() }), stopHookActive: false, promptId: 'p1', fetchStatus, log });
    expect(d).toEqual({ outcome: 'allow' });
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('unbound allows without asking the server', async () => {
    const fetchStatus = vi.fn(notDone);
    const d = await decideTurnEnd({ cache: makeCache(), stopHookActive: false, promptId: 'p1', fetchStatus, log });
    expect(d).toEqual({ outcome: 'allow' });
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('no cache allows', async () => {
    const d = await decideTurnEnd({ cache: null, stopHookActive: false, promptId: 'p1', fetchStatus: notDone, log });
    expect(d).toEqual({ outcome: 'allow' });
  });

  it('bound and not done blocks, naming the task', async () => {
    const d = await decideTurnEnd({ cache: makeCache({ binding: makeBinding() }), stopHookActive: false, promptId: 'p1', fetchStatus: notDone, log });
    expect(d).toEqual({
      outcome: 'block',
      promptId: 'p1',
      message: 'Ceetrix task 510.2 (Hook program) is bound and not completed in Ceetrix. Complete it with the task tool before telling the developer you are done, or ask them to unbind it.',
    });
  });

  it('honours stop_hook_active (recursion guard)', async () => {
    const fetchStatus = vi.fn(notDone);
    const d = await decideTurnEnd({ cache: makeCache({ binding: makeBinding() }), stopHookActive: true, promptId: 'p1', fetchStatus, log });
    expect(d).toEqual({ outcome: 'allow' });
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('holds at most once per prompt_id', async () => {
    const cache = makeCache({ binding: makeBinding(), held_turn_prompt_id: 'p1' });
    expect(await decideTurnEnd({ cache, stopHookActive: false, promptId: 'p1', fetchStatus: notDone, log })).toEqual({ outcome: 'allow' });
    expect((await decideTurnEnd({ cache, stopHookActive: false, promptId: 'p2', fetchStatus: notDone, log })).outcome).toBe('block');
  });

  it('done clears the binding and allows', async () => {
    const d = await decideTurnEnd({
      cache: makeCache({ binding: makeBinding() }),
      stopHookActive: false,
      promptId: 'p1',
      fetchStatus: async () => ({ kind: 'status', status: 'done' }),
      log,
    });
    expect(d).toEqual({ outcome: 'allow', clearBinding: true });
  });

  it('server unreachable allows and records', async () => {
    const rec = recordingLog();
    const d = await decideTurnEnd({
      cache: makeCache({ binding: makeBinding() }),
      stopHookActive: false,
      promptId: 'p1',
      fetchStatus: async () => ({ kind: 'unreachable' }),
      log: rec.log,
    });
    expect(d).toEqual({ outcome: 'allow' });
    expect(rec.lines.join('\n')).toMatch(/unreachable/);
  });
});

describe('decidePostTool', () => {
  const bound = makeCache({ binding: makeBinding({ story_id: '510', seq: 2 }) });

  it('update to in-progress binds', () => {
    expect(decidePostTool(makeCache(), { action: 'update', story_id: '510', seq: 3, status: 'in-progress' })).toEqual({ kind: 'bind', story_id: '510', seq: 3 });
  });

  it('complete of the bound task unbinds', () => {
    expect(decidePostTool(bound, { action: 'complete', story_id: '510', seq: 2 })).toEqual({ kind: 'unbind', story_id: '510', seq: 2 });
  });

  it('update to done of the bound task unbinds', () => {
    expect(decidePostTool(bound, { action: 'update', story_id: '510', seq: 2, status: 'done' })).toEqual({ kind: 'unbind', story_id: '510', seq: 2 });
  });

  it('complete_bulk containing the bound seq unbinds', () => {
    expect(decidePostTool(bound, { action: 'complete_bulk', story_id: '510', tasks: [{ seq: 1 }, { seq: 2 }] })).toEqual({ kind: 'unbind', story_id: '510', seq: 2 });
  });

  it('complete of another task is ignored', () => {
    expect(decidePostTool(bound, { action: 'complete', story_id: '510', seq: 9 })).toEqual({ kind: 'ignore' });
    expect(decidePostTool(bound, { action: 'complete', story_id: '511', seq: 2 })).toEqual({ kind: 'ignore' });
  });

  it('other actions are ignored', () => {
    expect(decidePostTool(bound, { action: 'get', story_id: '510', seq: 2 })).toEqual({ kind: 'ignore' });
  });

  it('none does nothing', () => {
    expect(decidePostTool(makeCache({ strictness: 'none' }), { action: 'update', story_id: '510', seq: 3, status: 'in-progress' })).toEqual({ kind: 'ignore' });
  });

  it('unregistered does nothing', () => {
    expect(decidePostTool(makeCache({ registered: false }), { action: 'update', story_id: '510', seq: 3, status: 'in-progress' })).toEqual({ kind: 'ignore' });
  });
});
