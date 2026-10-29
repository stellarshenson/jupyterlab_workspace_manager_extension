import type { ISection } from './model';

/** What clean-up does to one workspace (DQ-22). */
export type CleanOutcome = 'deleted' | 'emptied' | 'kept';

/** One workspace of the clean-up confirmation: its name, what it holds, and its outcome. */
export interface ICleanRow {
  id: string;
  /** the paths of its tabs */
  tabs: string[];
  /** `terminal <name>` per terminal */
  terminals: string[];
  /** the kernelspec name and the notebook or console, per kernel */
  kernels: string[];
  outcome: CleanOutcome;
}

/**
 * The workspaces clean-up acts on, in model order: this window's workspace is
 * emptied, a workspace another window shows is kept, every other is deleted.
 */
export function cleanRows(sections: ISection[], kept: string[]): ICleanRow[] {
  return sections.map(section => ({
    id: section.id,
    tabs: section.tabs.map(tab => tab.path ?? tab.label),
    terminals: section.terminals.map(t => `terminal ${t.name}`),
    kernels: section.kernels.map(k =>
      k.detail ? `${k.label} (${k.detail})` : k.label
    ),
    outcome: section.current
      ? 'emptied'
      : kept.includes(section.id)
        ? 'kept'
        : 'deleted'
  }));
}

/**
 * The question line of the confirmation: the count, then a clause per outcome -
 * deleted as a count, emptied and kept by name.
 */
export function cleanSummary(rows: ICleanRow[]): string {
  const deleted = rows.filter(row => row.outcome === 'deleted').length;
  const emptied = rows.filter(row => row.outcome === 'emptied').map(r => r.id);
  const kept = rows.filter(row => row.outcome === 'kept').map(r => r.id);
  const clauses: string[] = [];
  if (deleted) {
    clauses.push(`${deleted} ${deleted === 1 ? 'is' : 'are'} deleted`);
  }
  if (emptied.length) {
    clauses.push(
      `${list(emptied)} ${emptied.length === 1 ? 'is' : 'are'} emptied`
    );
  }
  if (kept.length) {
    const one = kept.length === 1;
    clauses.push(
      `${list(kept)} ${one ? 'is' : 'are'} kept because another window shows ${one ? 'it' : 'them'}`
    );
  }
  const n = rows.length;
  return `Clean up ${n} workspace${n === 1 ? '' : 's'}? ${sentence(clauses)}.`;
}

/** Whether clean-up would change anything: a workspace to delete, or this one holding something. */
export function cleanable(rows: ICleanRow[]): boolean {
  return rows.some(
    row =>
      row.outcome === 'deleted' ||
      (row.outcome === 'emptied' &&
        !!(row.tabs.length || row.terminals.length || row.kernels.length))
  );
}

function list(names: string[]): string {
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function sentence(clauses: string[]): string {
  if (clauses.length < 2) {
    return clauses.join('');
  }
  if (clauses.length === 2) {
    return `${clauses[0]} and ${clauses[1]}`;
  }
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
}
