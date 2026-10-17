/**
 * The hook program's wording (story 510).
 *
 * The server serves every hook.* template in the registration reply, from its
 * prompts table. These compiled-in defaults are the fallback when a key is
 * absent or blank, and must match the server's defaults.ts text. Every
 * fallback is logged. A rendered message is never blank.
 *
 * hook.deny.no_project and hook.warn.no_project word the policy file's
 * no_project setting; hook.deny.internal_error words a failure of the
 * per-write decision itself. The server serves all three like the rest.
 */

import type { Logger } from './types.js';

export const DEFAULT_WORDING = {
  'hook.prompt.bound':
    'Ceetrix task ${story_id}.${seq}: ${title}\n${body}\nExpected files: ${expected_scope}\nOff limits: ${forbidden}\nStay inside this task; complete it through Ceetrix before saying you are done.',
  'hook.prompt.unbound_enforce':
    'No Ceetrix task is bound to this session, and this project requires one before any file is changed. ${next_task_line} Recommend it to the developer and start it only once they agree, or ask whether to create a story for this work.',
  'hook.prompt.unbound_advise':
    "No Ceetrix task is bound to this session. ${next_task_line} If this work belongs to a story, recommend that task to the developer and start it only once they agree; otherwise you may proceed as work outside Ceetrix's record.",
  'hook.prompt.settings_unknown':
    "Ceetrix could not determine this project's settings for this session, so nothing is being checked.",
  'hook.prompt.stale':
    'This Ceetrix hook program is older than the server expects; rerun the Ceetrix setup command to update it.',
  'hook.next_task_line': 'Ceetrix recommends task ${story_id}.${seq}, ${title}${capability_clause}.',
  'hook.next_task_capability': ', which builds ${capability}',
  'hook.next_task_none': 'No task is open in this project.',
  'hook.deny.no_task':
    '[${strictness}] No Ceetrix task is bound. ${next_task_line} Bind it with the task tool (set it in progress), or ask the developer to create a story for this work.',
  'hook.deny.outside_scope':
    '[${strictness}] ${path} is outside the expected scope of task ${story_id}.${seq}. Expected scope: ${expected_scope}. Bind a different task or ask the developer to widen the scope.',
  'hook.deny.forbidden':
    '[${strictness}] ${path} is in the forbidden list of task ${story_id}.${seq} (${pattern}). Bind a different task or ask the developer.',
  'hook.deny.ceetrix_dir':
    "[${strictness}] ${path} is inside Ceetrix's own project files. Use the Ceetrix tools instead of editing these files.",
  'hook.deny.unknown_target':
    "[${strictness}] Ceetrix could not determine which files this command writes, so it cannot check it against the task's rules.",
  'hook.deny.policy_invalid':
    "[${strictness}] .ceetrix/policy.yaml could not be read: ${error}. Fix the file; strictness is set in the project's settings, not in this file.",
  'hook.deny.internal_error':
    "[${strictness}] Ceetrix could not check this write: ${error}. Tell the developer that the hook failed; the write was not checked against the task's rules.",
  'hook.deny.no_project':
    'Ceetrix found no project for this repository, and .ceetrix/policy.yaml sets no_project: deny, so no file may be changed. Set this repository up in Ceetrix or change the policy.',
  'hook.warn.prefix': 'Ceetrix (advise): this write was allowed. ',
  'hook.warn.no_project':
    'Ceetrix found no project for this repository, so this write was allowed without being checked against any task.',
  'hook.hold.turn_end':
    'Ceetrix task ${story_id}.${seq} (${title}) is bound and not completed in Ceetrix. Complete it with the task tool before telling the developer you are done, or ask them to unbind it.',
  'hook.reminder.unbound':
    'Ceetrix: story ${story_external_id} is in progress and no task is bound to this session. ${next_task_line} If the current work belongs to the story, bind that task (set it in progress) before writing.',
} as const;

export type WordingKey = keyof typeof DEFAULT_WORDING;

export const WORDING_KEYS = Object.keys(DEFAULT_WORDING) as WordingKey[];

export type WordingVars = Record<string, string | number>;

const VARIABLE = /\$\{([A-Za-z0-9_]+)\}/g;

function substitute(template: string, vars: WordingVars): string {
  return template.replace(VARIABLE, (_m, name: string) => (name in vars ? String(vars[name]) : ''));
}

const defaultLog: Logger = (m) => process.stderr.write(`${m}\n`);

/**
 * Render one message.
 *
 * @param wording - The registration reply's wording map (may be null)
 * @param key - Which message
 * @param vars - `${name}` values; unknown names render empty
 * @param log - Where fallbacks are reported
 */
export function renderWording(
  wording: Record<string, string> | null | undefined,
  key: WordingKey,
  vars: WordingVars,
  log: Logger = defaultLog,
): string {
  const served = wording?.[key];
  if (typeof served === 'string' && served.trim().length > 0) {
    const out = substitute(served, vars);
    if (out.trim().length > 0) return out;
    log(`ceetrix-hook: served wording for ${key} rendered blank; using the compiled default`);
  } else {
    log(`ceetrix-hook: wording ${key} not served; using the compiled default`);
  }
  return substitute(DEFAULT_WORDING[key], vars);
}
