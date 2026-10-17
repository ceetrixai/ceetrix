/**
 * Pre-write decision table: strictness (none, advise, enforce) crossed with
 * binding state (no cache, cache without binding, cache with binding) crossed
 * with target class (ceetrix dir, forbidden, outside scope, inside scope,
 * unknown). Every cell is asserted, then the edge cases.
 */
import { describe, it, expect } from 'vitest';
import { decidePreWrite, type PreWriteDecision } from '../../src/hook/decide.js';
import type { Strictness, WriteTarget } from '../../src/hook/types.js';
import { makeCache, makeBinding, recordingLog, FIXTURE_REPO } from './helpers.js';

type BindingState = 'no_cache' | 'unbound' | 'bound';
type TargetClass = 'ceetrix_dir' | 'forbidden' | 'outside_scope' | 'inside_scope' | 'unknown';

const TARGETS: Record<TargetClass, WriteTarget> = {
  ceetrix_dir: { kind: 'paths', paths: [`${FIXTURE_REPO}/.ceetrix/policy.yaml`] },
  forbidden: { kind: 'paths', paths: [`${FIXTURE_REPO}/secrets/key.pem`] },
  outside_scope: { kind: 'paths', paths: [`${FIXTURE_REPO}/README.md`] },
  inside_scope: { kind: 'paths', paths: [`${FIXTURE_REPO}/packages/ceetrix-cli/src/hook/main.ts`] },
  unknown: { kind: 'unknown', reason: 'eval' },
};

/** The rule enforce/advise apply, or null for allow. */
const EXPECTED_RULE: Record<Exclude<BindingState, 'no_cache'>, Record<TargetClass, string | null>> = {
  unbound: {
    ceetrix_dir: 'ceetrix_dir',
    forbidden: 'no_task',
    outside_scope: 'no_task',
    inside_scope: 'no_task',
    unknown: 'unknown_target',
  },
  bound: {
    ceetrix_dir: 'ceetrix_dir',
    forbidden: 'forbidden',
    outside_scope: 'outside_scope',
    inside_scope: null,
    unknown: 'unknown_target',
  },
};

function decide(strictness: Strictness, state: BindingState, target: TargetClass): PreWriteDecision {
  const { log } = recordingLog();
  const cache =
    state === 'no_cache'
      ? null
      : makeCache({ strictness, binding: state === 'bound' ? makeBinding() : null });
  return decidePreWrite({ cache, target: TARGETS[target], log });
}

const STRICTNESSES: Strictness[] = ['none', 'advise', 'enforce'];
const STATES: BindingState[] = ['no_cache', 'unbound', 'bound'];
const CLASSES = Object.keys(TARGETS) as TargetClass[];

describe('decision table', () => {
  for (const strictness of STRICTNESSES) {
    for (const state of STATES) {
      for (const target of CLASSES) {
        it(`${strictness} / ${state} / ${target}`, () => {
          const d = decide(strictness, state, target);
          if (state === 'no_cache') {
            expect(d.outcome).toBe('allow');
            return;
          }
          if (strictness === 'none') {
            expect(d).toEqual({ outcome: 'allow' });
            return;
          }
          const rule = EXPECTED_RULE[state][target];
          if (rule === null) {
            expect(d).toEqual({ outcome: 'allow' });
            return;
          }
          expect(d.outcome).toBe(strictness === 'enforce' ? 'deny' : 'warn');
          if (d.outcome === 'allow') return;
          expect(d.rule).toBe(rule);
          expect(d.message.trim().length).toBeGreaterThan(0);
        });
      }
    }
  }
});

describe('messages', () => {
  it('a no_task deny names the recommended next task', () => {
    const d = decide('enforce', 'unbound', 'inside_scope');
    expect(d.outcome === 'deny' && d.message).toBe(
      '[enforce] No Ceetrix task is bound. Ceetrix recommends task 510.22, Recommend one next task, which builds Next task. Bind it with the task tool (set it in progress), or ask the developer to create a story for this work.',
    );
  });

  it('a no_task deny with no open task uses the no-open-task line', () => {
    const { log } = recordingLog();
    const d = decidePreWrite({ cache: makeCache({ next_task: null }), target: TARGETS.inside_scope, log });
    expect(d.outcome === 'deny' && d.message).toContain('No task is open in this project.');
  });

  it('an advise warning is the deny text with the warn prefix and no [strictness]', () => {
    const d = decide('advise', 'bound', 'outside_scope');
    expect(d.outcome === 'warn' && d.message).toBe(
      'Ceetrix (advise): this write was allowed. README.md is outside the expected scope of task 510.2. Expected scope: packages/ceetrix-cli/src/hook/**. Bind a different task or ask the developer to widen the scope.',
    );
  });

  // Seen on Claude Code 2.1.302 (2026-10-17): the prefix ended ", but " and the
  // unbound deny text starts a sentence, so the model read "allowed, but No Ceetrix task".
  it('an unbound advise warning reads as two sentences', () => {
    const d = decide('advise', 'unbound', 'inside_scope');
    expect(d.outcome === 'warn' && d.message).toMatch(/^Ceetrix \(advise\): this write was allowed\. No Ceetrix task is bound\./);
  });

  it('a forbidden deny names the matching pattern', () => {
    const d = decide('enforce', 'bound', 'forbidden');
    expect(d.outcome === 'deny' && d.message).toContain('(secrets/**)');
  });

  it('a no-cache allow is recorded as degraded', () => {
    const d = decide('enforce', 'no_cache', 'inside_scope');
    expect(d).toEqual({ outcome: 'allow', degraded: 'cache_missing' });
  });
});

describe('scope edge cases', () => {
  const { log } = recordingLog();
  const at = (rel: string): WriteTarget => ({ kind: 'paths', paths: [`${FIXTURE_REPO}/${rel}`] });

  it('empty scope is unrestricted', () => {
    const cache = makeCache({ binding: makeBinding({ expected_scope: [] }) });
    expect(decidePreWrite({ cache, target: at('anything/at/all.ts'), log }).outcome).toBe('allow');
  });

  it('single-entry scope allows only that entry', () => {
    const cache = makeCache({ binding: makeBinding({ expected_scope: ['src/a.ts'] }) });
    expect(decidePreWrite({ cache, target: at('src/a.ts'), log }).outcome).toBe('allow');
    expect(decidePreWrite({ cache, target: at('src/b.ts'), log }).outcome).toBe('deny');
  });

  it('a path equal to the glob root is in scope', () => {
    const cache = makeCache({ binding: makeBinding({ expected_scope: ['src/hook/**'] }) });
    expect(decidePreWrite({ cache, target: at('src/hook'), log }).outcome).toBe('allow');
  });

  it('a retry binding treats scope as unrestricted but still applies repo forbidden globs', () => {
    const cache = makeCache({ binding: makeBinding({ retry: true, expected_scope: ['src/only.ts'], forbidden: [] }) });
    expect(decidePreWrite({ cache, target: at('README.md'), log }).outcome).toBe('allow');
    const d = decidePreWrite({ cache, target: at('vendor/lib.js'), log });
    expect(d.outcome === 'deny' && d.rule).toBe('forbidden');
  });

  it('repo-wide forbidden globs apply to a bound task', () => {
    const cache = makeCache({ binding: makeBinding({ expected_scope: [] }) });
    const d = decidePreWrite({ cache, target: at('vendor/lib.js'), log });
    expect(d.outcome === 'deny' && d.rule).toBe('forbidden');
  });

  it('a path outside the repo is not checked', () => {
    const cache = makeCache({ binding: null });
    expect(decidePreWrite({ cache, target: { kind: 'paths', paths: ['/tmp/x'] }, log }).outcome).toBe('allow');
  });

  it('a command that writes nothing is allowed', () => {
    const cache = makeCache({ binding: null });
    expect(decidePreWrite({ cache, target: { kind: 'none' }, log }).outcome).toBe('allow');
  });

  it('with several targets the first violation decides', () => {
    const cache = makeCache({ binding: makeBinding() });
    const d = decidePreWrite({
      cache,
      target: { kind: 'paths', paths: [`${FIXTURE_REPO}/packages/ceetrix-cli/src/hook/a.ts`, `${FIXTURE_REPO}/README.md`] },
      log,
    });
    expect(d.outcome === 'deny' && d.rule).toBe('outside_scope');
  });
});

describe('policy file', () => {
  const { log } = recordingLog();
  const target: WriteTarget = { kind: 'paths', paths: [`${FIXTURE_REPO}/packages/ceetrix-cli/src/hook/main.ts`] };

  for (const error of ['YAML parse error at line 1', 'strictness is set in the project\'s settings, not in .ceetrix/policy.yaml']) {
    it(`malformed (${error.slice(0, 20)}…): enforce denies naming the error and the file`, () => {
      const cache = makeCache({ strictness: 'enforce', policy_error: error, binding: makeBinding() });
      const d = decidePreWrite({ cache, target, log });
      expect(d.outcome === 'deny' && d.rule).toBe('policy_invalid');
      expect(d.outcome === 'deny' && d.message).toContain(error);
      expect(d.outcome === 'deny' && d.message).toContain('.ceetrix/policy.yaml');
    });

    it(`malformed (${error.slice(0, 20)}…): advise warns`, () => {
      const cache = makeCache({ strictness: 'advise', policy_error: error, binding: makeBinding() });
      const d = decidePreWrite({ cache, target, log });
      expect(d.outcome === 'warn' && d.rule).toBe('policy_invalid');
    });

    it(`malformed (${error.slice(0, 20)}…): none ignores the file`, () => {
      const cache = makeCache({ strictness: 'none', policy_error: error, binding: makeBinding() });
      expect(decidePreWrite({ cache, target, log })).toEqual({ outcome: 'allow' });
    });
  }
});

describe('unregistered session', () => {
  const { log } = recordingLog();
  const target: WriteTarget = { kind: 'paths', paths: [`${FIXTURE_REPO}/a.ts`] };

  it('server unreachable: allow, degraded', () => {
    const cache = makeCache({ registered: false, strictness: null, degraded_reason: 'server_unreachable' });
    expect(decidePreWrite({ cache, target, log })).toEqual({ outcome: 'allow', degraded: 'server_unreachable' });
  });

  it('no project with no_project: deny denies', () => {
    const cache = makeCache({ registered: false, strictness: null, degraded_reason: 'no_project', no_project: 'deny' });
    const d = decidePreWrite({ cache, target, log });
    expect(d.outcome === 'deny' && d.rule).toBe('no_project');
  });

  it('no remote with no_project: allow_with_warning warns', () => {
    const cache = makeCache({ registered: false, strictness: null, degraded_reason: 'no_remote', no_project: 'allow_with_warning' });
    const d = decidePreWrite({ cache, target, log });
    expect(d.outcome === 'warn' && d.rule).toBe('no_project');
  });
});
