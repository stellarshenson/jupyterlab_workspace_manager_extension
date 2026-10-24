import type { IRecord } from './model';
import type { Colour } from './palette';

/** JupyterLab's own wording of its workspace name rule. */
export const NAME_RULE =
  'The name may contain letters, numbers, hyphens (-), and underscores (_).';

/** The most characters a short description holds; the server refuses more. */
export const PURPOSE_MAX = 100;

/**
 * Why `name` cannot be created, or null when Create is enabled. `existing` is a
 * fresh list of workspace ids: JupyterLab's own create saves over a workspace.
 */
export function nameProblem(name: string, existing: string[]): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NAME_RULE;
  }
  return existing.includes(name) ? `A workspace named ${name} exists` : null;
}

/**
 * What the Short description field keeps of `text`: no line break, so Enter
 * still creates, and at most 100 characters, counted as the server counts them.
 */
export function cleanPurpose(text: string): string {
  return Array.from(text.replace(/[\r\n]+/g, ' '))
    .slice(0, PURPOSE_MAX)
    .join('');
}

/** The counter under the Short description field: `<n>/100`. */
export function purposeCounter(text: string): string {
  return `${Array.from(text).length}/${PURPOSE_MAX}`;
}

/** The record PATCH of a new workspace: its colour, and a purpose only when given. */
export function newRecord(purpose: string, colour: Colour): IRecord {
  const text = purpose.trim();
  return text ? { colour, purpose: text } : { colour };
}
