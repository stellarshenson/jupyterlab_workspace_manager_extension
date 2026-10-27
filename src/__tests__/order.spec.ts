import { givePositions, moved } from '../model/order';

type Card = { id: string; position?: number; hidden?: boolean };

const cards = (spec: string): Card[] =>
  spec.split(' ').map((id, position) => ({
    id: id.replace('*', ''),
    position,
    hidden: id.endsWith('*')
  }));

/** The order after the writes, every position distinct. */
function apply(all: Card[], writes: { [id: string]: number }): string[] {
  const after = all.map(c => ({ ...c, position: writes[c.id] ?? c.position! }));
  expect(new Set(after.map(c => c.position)).size).toBe(after.length);
  return after.sort((a, b) => a.position - b.position).map(c => c.id);
}

/** Move `id` to index `to` of the shown cards counted without it. */
const move = (all: Card[], id: string, to: number) =>
  moved(
    all,
    all.filter(c => !c.hidden),
    id,
    to
  );

describe('order', () => {
  it('ACC-ACCORD-198-NEW-LAST: the workspaces without a position take the next ones after the highest, in their order', () => {
    expect(
      givePositions([
        { id: 'a', position: 4 },
        { id: 'b', position: 9.5 },
        { id: 'new' },
        { id: 'newer' }
      ])
    ).toEqual({ new: 10.5, newer: 11.5 });
    expect(givePositions([{ id: 'x' }, { id: 'y' }])).toEqual({ x: 0, y: 1 });
    expect(givePositions([{ id: 'a', position: 0 }])).toEqual({});
  });

  it('ACC-ACCORD-191-DRAG-ORDER: Move up, Move down and a drag to either end write one position; the other cards keep theirs', () => {
    const all = cards('a b c d');
    expect(move(all, 'c', 1)).toEqual({ c: 0.5 }); // Move up
    expect(apply(all, move(all, 'c', 1))).toEqual(['a', 'c', 'b', 'd']);
    expect(move(all, 'b', 2)).toEqual({ b: 2.5 }); // Move down
    expect(apply(all, move(all, 'b', 2))).toEqual(['a', 'c', 'b', 'd']);
    expect(move(all, 'd', 0)).toEqual({ d: -1 });
    expect(move(all, 'a', 3)).toEqual({ a: 4 });
    expect(apply(all, move(all, 'a', 3))).toEqual(['b', 'c', 'd', 'a']);
  });

  it('ACC-ACCORD-191-DRAG-ORDER: a hidden workspace keeps its position and its place between the cards around it', () => {
    const all = cards('a h* b c');
    // c dragged above a: h stays between a and b
    expect(move(all, 'c', 0)).toEqual({ c: -1 });
    expect(apply(all, move(all, 'c', 0))).toEqual(['c', 'a', 'h', 'b']);
    // b moved up above a, the shown card before it
    expect(apply(all, move(all, 'b', 0))).toEqual(['b', 'a', 'h', 'c']);
    // a moved down below b: it lands after h
    expect(move(all, 'a', 1)).toEqual({ a: 2.5 });
    expect(apply(all, move(all, 'a', 1))).toEqual(['h', 'b', 'a', 'c']);
  });

  it('ACC-ACCORD-191-DRAG-ORDER: when no number fits between two positions every workspace is numbered again, all distinct', () => {
    const all: Card[] = [
      { id: 'a', position: 1 },
      { id: 'b', position: 1 + Number.EPSILON },
      { id: 'c', position: 3 }
    ];
    expect(move(all, 'c', 1)).toEqual({ a: 0, c: 1, b: 2 });
    expect(apply(all, move(all, 'c', 1))).toEqual(['a', 'c', 'b']);
    // two windows gave the same position: a move between them separates them
    const same: Card[] = [
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 1 }
    ];
    expect(apply(same, move(same, 'a', 1))).toEqual(['b', 'a', 'c']);
  });
});
