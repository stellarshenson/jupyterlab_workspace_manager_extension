import { LabIcon } from '@jupyterlab/ui-components';

import { COLOURS, type Colour } from './model/palette';

const NS = 'jupyterlab_workspace_manager_extension';

// Stroke glyphs set `fill:none` inline: JupyterLab's `.jp-icon3[fill]` rule
// would otherwise fill them, and `.jp-icon3[stroke]` gives the theme colour.
const svg = (body: string, box = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 ${box} ${box}">${body}</svg>`;
const line = (shape: string, width = 1.2) =>
  shape.replace(
    '/>',
    ` class="jp-icon3" stroke="currentColor" stroke-width="${width}" stroke-linejoin="round" style="fill:none"/>`
  );

/** The sidebar tab: four panes in a 2 by 2 grid, the top-left one filled. */
export const panelIcon = new LabIcon({
  name: `${NS}:panel`,
  svgstr: svg(
    '<rect class="jp-icon3" fill="currentColor" stroke="currentColor" stroke-width="1.6" x="3" y="3" width="8" height="8" rx="1.5"/>' +
      line('<rect x="13" y="3" width="8" height="8" rx="1.5"/>', 1.6) +
      line('<rect x="3" y="13" width="8" height="8" rx="1.5"/>', 1.6) +
      line('<rect x="13" y="13" width="8" height="8" rx="1.5"/>', 1.6),
    24
  )
});

/** Open workspace: an arrow in a circle. */
export const openIcon = new LabIcon({
  name: `${NS}:open`,
  svgstr: svg(
    line('<circle cx="8" cy="8" r="6"/>') +
      line('<path d="M5 8h5.5M8.3 5.5l2.5 2.5-2.5 2.5"/>')
  )
});

/** Close all tabs: a crossed tab before another. */
export const closeTabsIcon = new LabIcon({
  name: `${NS}:close-tabs`,
  svgstr: svg(
    line('<rect x="2" y="4" width="10" height="9" rx="1"/>', 1.1) +
      line('<path d="M4 4V2.5h10v9h-2"/>', 1.1) +
      line('<path d="M4.8 6.3l4.4 4.4M9.2 6.3l-4.4 4.4"/>', 1.1)
  )
});

/** Terminals: an outline prompt, lighter than JupyterLab's filled terminalIcon. */
export const terminalGlyph = new LabIcon({
  name: `${NS}:terminal`,
  svgstr: svg(
    line('<rect x="1" y="2.5" width="14" height="11" rx="1.5"/>') +
      line('<path d="M4 6l2.5 2L4 10M8 10.5h3.5"/>')
  )
});

const EYE =
  line(
    '<path d="M1.5 8c2.2-3.6 4.3-5 6.5-5s4.3 1.4 6.5 5c-2.2 3.6-4.3 5-6.5 5s-4.3-1.4-6.5-5z"/>'
  ) + '<circle class="jp-icon3" fill="currentColor" cx="8" cy="8" r="2"/>';

/** Show hidden workspaces. */
export const eyeIcon = new LabIcon({ name: `${NS}:eye`, svgstr: svg(EYE) });

/** Hide workspace, and the mark of a hidden one. */
export const eyeOffIcon = new LabIcon({
  name: `${NS}:eye-off`,
  svgstr: svg(EYE + line('<path d="M2.5 13.5l11-11"/>', 1.3))
});

/** An armed Confirm delete: the design system's warning sign, the exclamation as holes. */
export const warningIcon = new LabIcon({
  name: `${NS}:warning`,
  svgstr: svg(
    '<path class="jp-icon3" fill="currentColor" fill-rule="evenodd" d="M12 2.6a1.7 1.7 0 0 1 1.48.86l8.1 14.02A1.7 1.7 0 0 1 20.1 20H3.9a1.7 1.7 0 0 1-1.48-2.52l8.1-14.02A1.7 1.7 0 0 1 12 2.6zM11 9h2v5h-2V9zm0 7h2v2h-2v-2z"/>',
    24
  )
});

/** The Colour swatches: as the Tab Colour menu of the colourful tab extension. */
export const swatchIcons = {} as Record<Colour, LabIcon>;
for (const colour of COLOURS) {
  swatchIcons[colour] = new LabIcon({
    name: `${NS}:swatch-${colour}`,
    svgstr: svg(
      `<rect class="jp-WorkspaceManager-swatch jp-mod-${colour}" x="2" y="2" width="12" height="12" rx="2"/>`
    )
  });
}
