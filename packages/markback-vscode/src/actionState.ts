import type { Action } from "markbackjs";

// Well-known action verbs the extension records/acts on. The format itself is
// freeform; these are the ones with UI meaning.
export const VERB_CREATED = "created";
export const VERB_RESOLVED = "resolved";
export const VERB_REOPENED = "reopened";

// A record is resolved iff its most recent resolve/reopen action is `resolved`.
// `created` (and any other verb) does not change resolution. Pure — no vscode.
export function isResolved(actions: Action[]): boolean {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const v = actions[i].verb;
    if (v === VERB_RESOLVED) return true;
    if (v === VERB_REOPENED) return false;
  }
  return false;
}
