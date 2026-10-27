import type { ISection } from './model';

type Placed = Pick<ISection, 'id' | 'position'>;

/**
 * Give each workspace without a stored position the next one after the
 * highest, in the order of `sections`, which puts them last as they sort now.
 * A stored position stays, so a save, which sets `created` again (jupyterlab_server
 * reads it from the file's ctime), moves no card.
 */
export function givePositions(sections: Placed[]): { [id: string]: number } {
  let last = Math.max(-1, ...sections.map(s => s.position ?? -1));
  const given: { [id: string]: number } = {};
  for (const s of sections) {
    if (s.position === undefined) {
      given[s.id] = ++last;
    }
  }
  return given;
}

/**
 * The positions to store when workspace `id` moves to index `to` of the cards
 * shown once it is taken out. `all` holds every workspace in order, hidden ones
 * too, and `shown` the cards the panel shows. The moved card takes a position
 * just before the card it lands above, or after the last workspace, so no other
 * workspace changes; only when no number fits there is every workspace
 * numbered again in the new order.
 */
export function moved(
  all: Placed[],
  shown: Placed[],
  id: string,
  to: number
): { [id: string]: number } {
  const card = all.find(s => s.id === id)!;
  const others = all.filter(s => s !== card);
  const next = shown.filter(s => s.id !== id)[to];
  const i = next ? others.findIndex(s => s.id === next.id) : others.length;
  const before = others[i - 1]?.position;
  const after = others[i]?.position;
  const position =
    before === undefined
      ? (after ?? 0) - 1
      : after === undefined
        ? before + 1
        : (before + after) / 2;
  if (
    (before === undefined || before < position) &&
    (after === undefined || position < after)
  ) {
    return { [id]: position };
  }
  const writes: { [id: string]: number } = {};
  [...others.slice(0, i), card, ...others.slice(i)].forEach((s, n) => {
    if (s.position !== n) {
      writes[s.id] = n;
    }
  });
  return writes;
}
