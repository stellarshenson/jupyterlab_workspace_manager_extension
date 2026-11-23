/**
 * The file positions of a workspace's tabs, kept in sessionStorage across the
 * full page navigation a workspace switch makes. Each workspace owns one entry,
 * by the panel's tab key, so two workspaces showing one file each return to
 * their own place.
 *
 * A tab hidden by Lumino is display:none: it reads scrollTop 0 and drops a
 * write, so every place is remembered while its tab is visible (a scroll
 * listener, and the outgoing tab on a shell tab change), and the pagehide
 * snapshot only adds the tab still visible. Restore applies a visible tab at
 * once; a hidden one waits for its first show.
 */

import type { Widget } from '@lumino/widgets';

/** The kinds of tab whose position this store keeps. */
export type PositionKind = 'notebook' | 'editor' | 'markdown' | 'console';

/** Where one tab was when the page last hid. */
export interface IPosition {
  kind: PositionKind;
  /** the tab's outer scroll: the notebook's window, the editor's scroller, the rendered page or the console */
  scroll: number;
  /** a notebook's active cell index */
  cell?: number;
  /** that cell's own scroll */
  cellScroll?: number;
  /** an editor's cursor */
  cursor?: { line: number; column: number };
}

type IPositions = { [tab: string]: IPosition };

/** Where this browser keeps every workspace's file positions. */
const STORE =
  '@stellarshenson/jupyterlab-workspace-manager-extension:positions';

/** The whole store; {} when storage is absent or unreadable. */
function stored(): { [workspace: string]: IPositions } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null');
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? saved
      : {};
  } catch {
    return {};
  }
}

/** The positions stored for one workspace; {} when it has none or storage throws. */
export function load(workspace: string): IPositions {
  const entry = stored()[workspace];
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    ? entry
    : {};
}

/** Store one workspace's positions, keeping every other workspace's entry. */
export function keep(workspace: string, positions: IPositions): void {
  try {
    const store = stored();
    store[workspace] = positions;
    sessionStorage.setItem(STORE, JSON.stringify(store));
  } catch {
    // not stored: the positions last as long as this page
  }
}

/** The positions last seen while their tabs were visible, by workspace and tab key. */
const seen = new Map<string, IPositions>();

/** Keep one tab's position as the page saw it while the tab was visible. */
export function remember(
  workspace: string,
  tab: string,
  position: IPosition
): void {
  const positions = seen.get(workspace) ?? {};
  positions[tab] = position;
  seen.set(workspace, positions);
}

/** The positions the page saw while the tabs were visible, for one workspace. */
export function recall(workspace: string): IPositions {
  return { ...seen.get(workspace) };
}

/** Drop what the page saw of one workspace. */
export function forget(workspace: string): void {
  seen.delete(workspace);
}

function kindOf(widget: Widget): PositionKind | null {
  const content = (widget as any).content;
  if (widget.hasClass('jp-NotebookPanel')) {
    return 'notebook';
  }
  if (widget.hasClass('jp-ConsolePanel')) {
    return 'console';
  }
  if (content?.hasClass?.('jp-MarkdownViewer')) {
    return 'markdown';
  }
  return content?.editor?.getCursorPosition ? 'editor' : null;
}

/** The scroller of a rendered page or a console: its whole content scrolls. */
function scroller(
  widget: Widget,
  kind: 'markdown' | 'console'
): HTMLElement | null {
  return widget.node.querySelector<HTMLElement>(
    kind === 'markdown' ? '.jp-RenderedMarkdown' : '.jp-CodeConsole-content'
  );
}

const cellScroll = (content: any): HTMLElement | undefined =>
  content?.activeCell?.editor?.editor?.scrollDOM;

const editorScroll = (content: any): HTMLElement | undefined =>
  content?.editor?.editor?.scrollDOM;

/** The box a live tab scrolls, which a scroll listener watches; null for a tab that keeps no position. */
export function scrollNode(widget: Widget): HTMLElement | null {
  const kind = kindOf(widget);
  const content = (widget as any).content;
  if (kind === 'notebook') {
    return (content?.outerNode as HTMLElement | undefined) ?? null;
  }
  if (kind === 'editor') {
    return editorScroll(content) ?? null;
  }
  return kind === 'markdown' || kind === 'console'
    ? scroller(widget, kind)
    : null;
}

/** Where a live tab's file is now; null for a tab that keeps no position. */
export function capture(widget: Widget): IPosition | null {
  const kind = kindOf(widget);
  const content = (widget as any).content;
  if (kind === 'notebook') {
    const outer = content?.outerNode as HTMLElement | undefined;
    if (!outer) {
      return null;
    }
    const position: IPosition = {
      kind,
      scroll: outer.scrollTop,
      cell: content.activeCellIndex
    };
    const scrolled = cellScroll(content);
    if (scrolled) {
      position.cellScroll = scrolled.scrollTop;
    }
    return position;
  }
  if (kind === 'editor') {
    const scrolled = editorScroll(content);
    if (!scrolled) {
      return null;
    }
    const { line, column } = content.editor.getCursorPosition();
    return { kind, scroll: scrolled.scrollTop, cursor: { line, column } };
  }
  if (kind === 'markdown' || kind === 'console') {
    const node = scroller(widget, kind);
    return node ? { kind, scroll: node.scrollTop } : null;
  }
  return null;
}

/**
 * Apply a stored position now, and again once the widget's document model is
 * ready: at app.restored the model may still be loading, so the first write
 * lands on an empty widget. The model measures after it is ready, which drops
 * the ready write, so every kind re-asserts once on the next frame (the
 * notebook's own frame, the others from here). A widget without a document
 * context takes the first write only.
 */
export function applyWhenReady(widget: Widget, position: IPosition): void {
  apply(widget, position);
  const ready = (widget as any).context?.ready;
  if (ready && typeof ready.then === 'function') {
    void ready
      .then(() => {
        if (widget.isDisposed) {
          return;
        }
        apply(widget, position);
        if (position.kind !== 'notebook') {
          requestAnimationFrame(() => {
            if (!widget.isDisposed) {
              apply(widget, position);
            }
          });
        }
      })
      .catch(() => undefined);
  }
}

/** Apply a stored position to a live tab; a tab whose kind differs is skipped. */
export function apply(widget: Widget, position: IPosition): void {
  // the store is external input: a malformed entry is skipped, not thrown
  if (!position || kindOf(widget) !== position.kind) {
    return;
  }
  const content = (widget as any).content;
  if (position.kind === 'notebook') {
    const outer = content?.outerNode as HTMLElement | undefined;
    if (!outer) {
      return;
    }
    if (typeof position.cell === 'number') {
      content.activeCellIndex = position.cell;
    }
    const scrolled = cellScroll(content);
    if (scrolled && typeof position.cellScroll === 'number') {
      scrolled.scrollTop = position.cellScroll;
    }
    outer.scrollTop = position.scroll;
    // the windowed list clamps before its cells are measured: re-assert one frame later,
    // and render the list up to the active cell when it is still short
    requestAnimationFrame(() => {
      outer.scrollTop = position.scroll;
      if (
        typeof position.cell === 'number' &&
        outer.scrollTop < position.scroll
      ) {
        void content.scrollToItem?.(position.cell)?.then(() => {
          outer.scrollTop = position.scroll;
        });
      }
    });
    return;
  }
  if (position.kind === 'editor') {
    // the editor exists before its document does: a cursor past the empty
    // model's last line throws, so wait for the ready write in applyWhenReady
    if ((widget as any).context?.isReady === false) {
      return;
    }
    // the cursor first, so placing it cannot move the box off the stored scroll
    if (position.cursor) {
      content.editor.setCursorPosition(position.cursor, { scroll: false });
    }
    const scrolled = editorScroll(content);
    if (scrolled) {
      scrolled.scrollTop = position.scroll;
    }
    return;
  }
  const node = scroller(widget, position.kind);
  if (node) {
    node.scrollTop = position.scroll;
  }
}
