import type { IKernelRow, ISection, ITabRow, ITerminalRow } from './model';

/**
 * The match of the AI assistants panel: case, accents, spaces and the
 * separators - _ . / are ignored, then a substring match with up to 5%
 * edits, which reaches one edit at 10 characters.
 */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  const h = normalise(haystack);
  const n = normalise(needle);
  if (h.includes(n)) {
    return true;
  }
  const tol = Math.round(n.length * 0.05);
  if (tol === 0) {
    return false;
  }
  for (let len = n.length - tol; len <= n.length + tol; len += 1) {
    for (let i = 0; i + len <= h.length; i += 1) {
      if (levenshtein(h.slice(i, i + len), n) <= tol) {
        return true;
      }
    }
  }
  return false;
}

/** A card as the filter shows it: its section and the rows it shows. */
export interface ICard {
  section: ISection;
  tabs: ITabRow[];
  terminals: ITerminalRow[];
  kernels: IKernelRow[];
  /** N of the header's N of M: the rows the card shows */
  shown: number;
  /** M: the rows the section holds */
  total: number;
}

/**
 * The cards the panel shows for `query`. Hidden workspaces take part only
 * while `showHidden` is on. A workspace whose name or purpose matches shows all
 * its rows; any other shows its matching rows, and none without a match.
 * `unmatched` counts the workspaces without a match.
 */
export function filterSections(
  sections: ISection[],
  query: string,
  showHidden: boolean
): { cards: ICard[]; unmatched: number } {
  const q = query.trim();
  const cards: ICard[] = [];
  let unmatched = 0;
  for (const section of sections) {
    if (section.hidden && !showHidden) {
      continue;
    }
    const all =
      !q ||
      (section.id !== null &&
        (fuzzyMatch(section.id, q) || fuzzyMatch(section.purpose, q)));
    const keep = <T>(
      rows: T[],
      texts: (row: T) => (string | null | undefined)[]
    ) =>
      all
        ? rows
        : rows.filter(row => texts(row).some(t => t && fuzzyMatch(t, q)));
    const tabs = keep(section.tabs, t => [t.label, t.path, t.title]);
    const terminals = keep(section.terminals, t => [
      t.process,
      `terminal ${t.name}`,
      t.title
    ]);
    const kernels = keep(section.kernels, k => [k.name, k.detail, k.path]);
    const shown = tabs.length + terminals.length + kernels.length;
    if (all || shown) {
      const total =
        section.tabs.length + section.terminals.length + section.kernels.length;
      cards.push({ section, tabs, terminals, kernels, shown, total });
    } else if (section.id !== null) {
      unmatched += 1;
    }
  }
  return { cards, unmatched };
}

function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s\-_./]+/g, '');
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = [];
  for (let j = 0; j <= b.length; j += 1) {
    dp[j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
