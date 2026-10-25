/**
 * The six workspace colours, in the order of jupyterlab_colourful_tab_extension.
 * The values live in style/base.css as `--jp-workspace-manager-<colour>`.
 */
export const COLOURS = [
  'rose',
  'peach',
  'lemon',
  'mint',
  'sky',
  'lavender'
] as const;

export type Colour = (typeof COLOURS)[number];

/** The palette colour after `last`; sky when none was given yet. */
export function nextColour(last: Colour | null): Colour {
  return last === null ? 'sky' : COLOURS[(COLOURS.indexOf(last) + 1) % 6];
}

/**
 * Give each workspace without a stored colour the colour after the last one
 * given, in the order of `ids`. A stored colour never changes, so deleting a
 * workspace does not move the colours of the others.
 *
 * `last` is the colour given most recently, which the records file keeps for
 * every window. `given` holds the new colours to store.
 */
export function assignColours(
  ids: string[],
  stored: { [id: string]: Colour | undefined },
  last: Colour | null
): {
  colours: { [id: string]: Colour };
  given: { [id: string]: Colour };
  last: Colour | null;
} {
  const colours: { [id: string]: Colour } = {};
  const given: { [id: string]: Colour } = {};
  for (const id of ids) {
    const colour = stored[id];
    if (colour) {
      colours[id] = colour;
    } else {
      last = nextColour(last);
      colours[id] = given[id] = last;
    }
  }
  return { colours, given, last };
}
