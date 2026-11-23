import type { ILayoutRestorer, JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import type { IDocumentManager } from '@jupyterlab/docmanager';
import type {
  IRunningSessionManagers,
  IRunningSessions,
  IRunningSessionSidebar
} from '@jupyterlab/running';
import type { IStateDB } from '@jupyterlab/statedb';
import type { TranslationBundle } from '@jupyterlab/translation';
import type { ISectionEntry } from '@jupyterlab/apputils';
import {
  addIcon,
  caretDownIcon,
  caretRightIcon,
  closeIcon,
  fileIcon,
  filterIcon,
  kernelIcon,
  LabIcon,
  launchIcon,
  refreshIcon,
  SidePanel,
  tabIcon,
  textEditorIcon,
  Toolbar
} from '@jupyterlab/ui-components';
import { MimeData } from '@lumino/coreutils';
import { Drag } from '@lumino/dragdrop';
import type { Message } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import type { Menu } from '@lumino/widgets';
import { Panel, Widget } from '@lumino/widgets';
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import {
  claim,
  elsewhere,
  type ILoaded,
  type ISwitch,
  load,
  patchMeta,
  removeWorkspace,
  renameWorkspace,
  switches,
  workspaces
} from '../api';
import {
  eraserIcon,
  eyeIcon,
  eyeOffIcon,
  pageIcon,
  powerIcon,
  terminalGlyph
} from '../icons';
import { age, type IAge } from '../model/age';
import { cleanable, cleanRows } from '../model/cleanup';
import { filterSections, type ICard } from '../model/filter';
import {
  buildModel,
  formatCpu,
  formatMemory,
  type IKernelRow,
  type IModel,
  type IRecord,
  type ISection,
  type ITab,
  type ITabRow,
  type ITerminalRow,
  lines,
  tabsOf,
  terminalLabel,
  terminalTabName,
  withoutTabs,
  withTab
} from '../model/model';
import { newRecord } from '../model/new';
import { givePositions, moved } from '../model/order';
import { assignColours, type Colour, nextColour } from '../model/palette';
import { imageIcon, pageUrl, PAGE_CLASS } from '../page';
import {
  confirm,
  cleanUpDialog,
  descriptionDialog,
  newWorkspaceDialog
} from './dialogs';
import { Harmonica } from './harmonica';
import { actionMenu, type IRowAction, workspaceMenu } from './menus';
import {
  applyWhenReady,
  capture,
  keep,
  load as loadPositions,
  recall,
  remember,
  scrollNode,
  type IPosition
} from './position';

/** The section of the panel that lists the running language servers. */
const LANGUAGE_SERVERS = 'Language servers';
const POLL_MS = 10000;
/** The CLI switch channel is read every second: a workspace request must switch the window within 2 s. */
const SWITCH_MS = 1000;
const SPIN_MS = 500;
/** The MIME the advanced file browser's targets read a dragged item path from, relative to the server root. */
export const PATH_MIME = 'application/x-jupyterlab-drag-and-drop-path';
/** The MIME this panel's terminal target reads a dragged row's raw text from. */
export const TEXT_MIME = 'application/x-jupyterlab-workspace-manager-drag-text';
/** How far the pointer moves before a press on a row's icon starts a drag, in pixels. */
const DRAG_THRESHOLD = 4;
/** A tab to activate after the reload a workspace switch makes; the server keeps its request 90 s too. */
const PENDING_TAB =
  '@stellarshenson/jupyterlab-workspace-manager-extension:pending-tab';
const PENDING_MS = 30000;
/** The lists before the first reload: a list that fails at once stays empty. */
const EMPTY: ILoaded = {
  workspaces: [],
  records: {},
  last: null,
  terminals: [],
  kernels: [],
  resources: {},
  sessions: []
};

/** Where this browser keeps the closed panel sections: every section but the open one. */
const CLOSED_SECTIONS =
  '@stellarshenson/jupyterlab-workspace-manager-extension:closed-sections';

/** Where this browser keeps the open cards: the ids of the workspace cards open in the unfiltered view. */
const OPEN_CARDS =
  '@stellarshenson/jupyterlab-workspace-manager-extension:open-cards';

/** The command that reopens a saved web page tab, by the namespace of its saved key; a move into this window runs it with the saved data. */
const WEB_OPEN = new Map([
  ['server-proxy', 'server-proxy:open'],
  ['help-doc', 'help:open'],
  ['workspace-page', 'workspace-page:open']
]);

/**
 * The icon a saved tab without a path shows in its own window, by the namespace
 * of its saved key, for a row no live tab of this window draws
 * (DEF-PANEL-95-WEBTAB-ICON). A server-proxy or Help tab is not here: see
 * COPIED_ICON_KINDS.
 * shortcut: an lsp-diagnostics entry in a lab without jupyterlab-lsp draws the
 * loading glyph LabIcon.resolve makes; upgrade if such an entry shows.
 */
const SAVED_ICONS = new Map([
  ['setting-editor', 'ui-components:settings'],
  ['json-setting-editor', 'ui-components:settings'],
  ['logconsole', 'ui-components:list'],
  ['inspector', 'ui-components:inspector'],
  ['help-licenses', 'ui-components:copyright'],
  ['plugin-manager', 'ui-components:extension'],
  ['lsp-diagnostics', 'lsp:diagnostics']
]);

/**
 * The kinds whose own icon is the page favicon jupyterlab-vscode-icons-extension
 * sets once the page loads, which no saved entry holds: Move to workspace copies
 * the live icon into the moved entry as data.copiedIcon, and the restorer of the
 * target workspace's window saves the entry again without it
 * (ACC-LISTS-305-COPIED-ICON).
 */
const COPIED_ICON_KINDS = new Set(['server-proxy', 'help-doc']);

/** The longest icon svgstr a move copies and a card draws, in characters. */
const COPIED_ICON_MAX = 16384;

/** The elements a copied icon may hold: those of the favicon and the globes that extension draws. */
const COPIED_ICON_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'image'
]);

/**
 * The attributes a copied icon may hold: those of the favicon and the globes.
 * LabIcon passes the root's attributes to React as props, where one named
 * `children` unmounts the panel.
 */
const COPIED_ICON_ATTRIBUTES = new Set([
  'xmlns',
  'width',
  'height',
  'viewBox',
  'x',
  'y',
  'href',
  'fill',
  'stroke-width',
  'style',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd'
]);

/**
 * Whether `svgstr` is an icon a move copies and a card draws: at most
 * COPIED_ICON_MAX characters, COPIED_ICON_ELEMENTS, COPIED_ICON_ATTRIBUTES and
 * text only, because a card renders it from a saved workspace file.
 */
function copyable(svgstr: unknown): svgstr is string {
  if (typeof svgstr !== 'string' || svgstr.length > COPIED_ICON_MAX) {
    return false;
  }
  try {
    // LabIcon URI-decodes an svgstr before it parses it
    const svg = new DOMParser().parseFromString(
      decodeURIComponent(svgstr),
      'image/svg+xml'
    ).documentElement;
    // every node: LabIcon renders the svg's innerHTML through the HTML parser,
    // which reads elements out of an XML comment or processing instruction
    const walk = document.createTreeWalker(svg, NodeFilter.SHOW_ALL);
    for (let node: Node | null = svg; node; node = walk.nextNode()) {
      const e = node as Element;
      if (
        node.nodeType !== Node.TEXT_NODE &&
        (node.nodeType !== Node.ELEMENT_NODE ||
          !COPIED_ICON_ELEMENTS.has(e.localName) ||
          Array.from(e.attributes).some(
            a => !COPIED_ICON_ATTRIBUTES.has(a.name)
          ))
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** The hosts jupyterlab-vscode-icons-extension counts as local, besides the lab's origin. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/**
 * The globe jupyterlab-vscode-icons-extension draws on a live web page tab until
 * its favicon loads, chosen as it chooses: local-page for the lab's origin or a
 * loopback host, remote-page for another http or https site. Undefined for
 * another address, and where that extension is not installed: LabIcon.resolve
 * then answers its loading glyph, the refresh icon.
 */
function globeOf(url: string | undefined): LabIcon | undefined {
  let page: URL | undefined;
  try {
    page = url ? new URL(url, document.baseURI) : undefined;
  } catch {
    return undefined;
  }
  if (page?.protocol !== 'http:' && page?.protocol !== 'https:') {
    return undefined;
  }
  const local = page.origin === location.origin || LOOPBACK.has(page.hostname);
  const globe = LabIcon.resolve({
    icon: `jupyterlab_vscode_icons_extension:${local ? 'local' : 'remote'}-page`
  });
  return globe.svgstr === refreshIcon.svgstr ? undefined : globe;
}

/** The four section keys, in render order. */
const SECTION_KEYS = ['workspaces', 'kernels', 'terminals', 'servers'] as const;

/**
 * The open section kept in this browser, by its index: the first section the stored
 * closed sections leave open. A missing or unreadable value, no localStorage, or all
 * four closed, as release 1.0.9 stores a panel with every section closed, means WORKSPACES.
 */
function storedSection(): number {
  try {
    const closed = JSON.parse(
      window.localStorage.getItem(CLOSED_SECTIONS) ?? 'null'
    );
    return Array.isArray(closed)
      ? Math.max(
          0,
          SECTION_KEYS.findIndex(key => !closed.includes(key))
        )
      : 0;
  } catch {
    return 0;
  }
}

/**
 * The ids of the cards this browser keeps open: a missing or unreadable value,
 * no localStorage, or one that throws loads no card.
 */
export function storedCards(): string[] {
  try {
    const ids = JSON.parse(window.localStorage.getItem(OPEN_CARDS) ?? 'null');
    return Array.isArray(ids) && ids.every(id => typeof id === 'string')
      ? ids
      : [];
  } catch {
    return [];
  }
}

/** Add or remove one card id on the value this browser stores, so two windows keep each other's changes. */
export function keepCard(id: string, open: boolean): void {
  try {
    const ids = storedCards().filter(stored => stored !== id);
    if (open) {
      ids.push(id);
    }
    window.localStorage.setItem(OPEN_CARDS, JSON.stringify(ids));
  } catch {
    // not stored: the state lasts as long as this page
  }
}

const keyOf = (section: ISection) => `w:${section.id}`;
const dirname = (path = '') =>
  path.slice(0, Math.max(0, path.lastIndexOf('/')));

/**
 * The tab a switch request named, kept across the reload that switches
 * workspace; null when absent or older than 30 s.
 */
function pendingTab(): { workspace: string; path: string } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_TAB) ?? 'null');
    if (
      saved &&
      typeof saved.workspace === 'string' &&
      typeof saved.path === 'string' &&
      typeof saved.created === 'number' &&
      Math.abs(Date.now() - saved.created) <= PENDING_MS
    ) {
      return saved;
    }
  } catch {
    // no storage: the switch still happens, its tab is not activated
  }
  return null;
}

function keepPendingTab(tab: { workspace: string; path: string } | null): void {
  try {
    if (tab) {
      sessionStorage.setItem(
        PENDING_TAB,
        JSON.stringify({ ...tab, created: Date.now() })
      );
    } else {
      sessionStorage.removeItem(PENDING_TAB);
    }
  } catch {
    // see pendingTab
  }
}

export namespace WorkspacePanel {
  export interface IOptions {
    /** the shell, the commands and the service manager of the lab */
    app: JupyterFrontEnd;
    /** the lab's documents: to close them the way JupyterLab's close-all does */
    docManager: IDocumentManager;
    /** this window's workspace id */
    current: string;
    /** the id of this browser window for presence */
    window: string;
    managers?: IRunningSessionManagers | null;
    /** the layout restorer: a tab it tracks takes the name it saves the tab under */
    restorer?: ILayoutRestorer | null;
    /** the lab's state database: the layout is written through it before a switch */
    state?: IStateDB | null;
    /** the translation bundle of this extension */
    trans: TranslationBundle;
  }
}

/**
 * The workspace panel in the sidebar place of the Running panel: a toolbar
 * header (title and buttons; other extensions add theirs after them), the
 * filter field, then four sections - WORKSPACES holding one card per
 * workspace, KERNELS and TERMINALS with every running kernel and terminal, in a
 * workspace or not, and LANGUAGE SERVERS with the running language servers.
 * One section is open and takes the panel, and the wheel anywhere over the panel
 * scrolls it and folds it into the next (harmonica.ts). The cards are React, rendered
 * synchronously, so a reload keeps the scroll position, the focus and every
 * open card or menu.
 */
export class WorkspacePanel
  extends SidePanel
  implements IRunningSessionSidebar
{
  constructor(options: WorkspacePanel.IOptions) {
    super({ content: new Panel() });
    this._app = options.app;
    this._docManager = options.docManager;
    this._current = options.current;
    this._window = options.window;
    this._managers = options.managers ?? null;
    this._restorer = options.restorer ?? null;
    this._state = options.state ?? null;
    this._translation = options.trans;
    this.addClass('jp-WorkspaceManager');
    this.content.addClass('jp-WorkspaceManager-content');
    this.toolbar.addClass('jp-WorkspaceManager-header');

    const title = new Widget();
    title.addClass('jp-WorkspaceManager-title');
    const label = document.createElement('span');
    label.className = 'jp-WorkspaceManager-titleLabel';
    label.textContent = this._translation.__('WORKBENCH');
    title.node.appendChild(label);
    this.toolbar.addItem('title', title);
    this.toolbar.addItem('spacer', Toolbar.createSpacerItem());
    this._filterButton = button(filterIcon, 'Filter', () =>
      this._toggleFilter()
    );
    this.toolbar.addItem('filter', this._filterButton);
    this._hiddenButton = button(eyeIcon, 'Show hidden workspaces', () => {
      this._showHidden = !this._showHidden;
      pressed(this._hiddenButton, this._showHidden);
      this._render();
    });
    this.toolbar.addItem('show-hidden', this._hiddenButton);
    this._refreshButton = button(
      refreshIcon,
      'Refresh',
      () => void this.refresh()
    );
    this.toolbar.addItem('refresh', this._refreshButton);
    // a toolbar refuses a second item of one name: this keeps out the Search
    // Tabs button that @jupyterlab/running-extension:search-tabs adds under it
    const searchTabs = new Widget();
    searchTabs.hide();
    this.toolbar.addItem('open-as-modal', searchTabs);
    pressed(this._filterButton, false);
    pressed(this._hiddenButton, false);

    const body = (i: number) =>
      this.content.node.querySelector<HTMLElement>(
        `[data-section="${SECTION_KEYS[i]}"] > .jp-WorkspaceManager-sectionBody`
      );
    this._harmonica = new Harmonica(
      {
        span: () => {
          const list = this.content.node.querySelector(
            '.jp-WorkspaceManager-list'
          );
          // the bands and their lines, never a drawn list: a list drawn 1/64 px short would
          // shrink the next frame's span, and the open section's slack with it
          let bands = 0;
          for (const section of Array.from(list?.children ?? [])) {
            const style = getComputedStyle(section);
            bands +=
              (section.firstElementChild?.getBoundingClientRect().height ?? 0) +
              (parseFloat(style.borderTopWidth) || 0) +
              (parseFloat(style.borderBottomWidth) || 0);
          }
          // whole px: the open section takes the fraction left over
          return Math.max(
            0,
            Math.floor((list?.getBoundingClientRect().height ?? 0) - bands)
          );
        },
        scrollTop: i => body(i)?.scrollTop ?? 0,
        scrollHeight: i => body(i)?.scrollHeight ?? 0,
        scroll: (i, top) => {
          const b = body(i);
          if (b) {
            b.scrollTop = top;
          }
        },
        draw: (open, heights) => {
          const shown = (h: typeof heights) => Object.keys(h ?? {}).join();
          const changed =
            open !== this._open || shown(heights) !== shown(this._heights);
          if (open !== this._open) {
            this._open = open;
            try {
              window.localStorage.setItem(
                CLOSED_SECTIONS,
                JSON.stringify(SECTION_KEYS.filter((_, i) => i !== open))
              );
            } catch {
              // not stored: the state lasts as long as this page
            }
          }
          this._heights = heights;
          if (changed) {
            // a fold that removes the focused row gives the focus to the open band, not to the page
            const focused = document.activeElement?.closest(
              '.jp-WorkspaceManager-sectionBody'
            )
              ? document.activeElement
              : null;
            this._render();
            if (focused && !focused.isConnected) {
              this.content.node
                .querySelector<HTMLElement>(
                  `[data-section="${SECTION_KEYS[open]}"] > .jp-WorkspaceManager-sectionHeader`
                )
                ?.focus();
            }
          }
          SECTION_KEYS.forEach((_, i) => {
            const b = body(i);
            if (b) {
              b.style.flex =
                heights?.[i] === undefined ? '' : `0 0 ${heights[i]}px`;
            }
          });
        }
      },
      SECTION_KEYS.length,
      this._open
    );
    // the scrollbar every row keeps room for, from a probe that always shows one
    this._probe.className = 'jp-WorkspaceManager-gutterProbe';
    this._probe.setAttribute('aria-hidden', 'true');
    this.node.appendChild(this._probe);
    // the wheel anywhere over the panel drives the open section, never the one under the pointer;
    // over the open list the browser scrolls it natively until its end
    this.node.addEventListener(
      'wheel',
      e => {
        if (
          e.deltaY &&
          !e.ctrlKey &&
          this._harmonica.wheel(
            // a line of a Firefox mouse wheel is 16 px
            e.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? e.deltaY * 16
              : e.deltaY,
            !!body(this._harmonica.open)?.contains(e.target as Node)
          )
        ) {
          e.preventDefault();
        }
      },
      { passive: false }
    );

    this._root = createRoot(this.content.node);
    this._app.shell.currentChanged?.connect(this._currentChanged, this);
    // a switch is a full page navigation: the pagehide this page gets stores each live tab's file position
    window.addEventListener('pagehide', this._pagehide);
    void this._app.restored
      .then(() => this._restorePositions())
      .catch(() => undefined);
    this.content.node.addEventListener('focusout', e => this._releaseRow(e));
    // the lit row's detail lines stay for the press: removed, they pull what is below from under the pointer and lose its click
    this.content.node.addEventListener(
      'mousedown',
      () => {
        this._pressed = true;
        // a native drag of a card header sends pointercancel when it starts, and Chromium sends no mouseup
        const ends = ['mouseup', 'pointercancel'];
        const release = (): void => {
          ends.forEach(t => window.removeEventListener(t, release, true));
          this._pressed = false;
          this._releaseRow();
        };
        ends.forEach(t => window.addEventListener(t, release, true));
      },
      true
    );
    // kernel rows show the display names of the kernelspecs
    this._app.serviceManager.kernelspecs.specsChanged.connect(
      this._render,
      this
    );
    if (this._managers) {
      this._managers.items().forEach(m => this._watch(m));
      this._managers.added.connect((_, m) => this._watch(m));
    }
    this._render();
  }

  // IMovableSectionSource: the cards are no movable sections
  readonly accordionPanel = null;
  get sectionAdded(): Signal<this, ISectionEntry> {
    return this._sectionAdded;
  }
  getSections(): ReadonlyArray<ISectionEntry> {
    return [];
  }
  removeSectionById(): Widget | null {
    return null;
  }
  reinsertSection(): void {
    // no section ever leaves this panel
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    window.removeEventListener('pagehide', this._pagehide);
    this._app.shell.currentChanged?.disconnect(this._currentChanged, this);
    // every scroll listener of the live tabs goes with the panel
    this._scrolls.abort();
    this._stopPolling();
    this._stopSwitch();
    this._harmonica.stop();
    this._root.unmount();
    super.dispose();
  }

  /** The refresh button: the icon turns for at least 500 ms, the button waits. */
  async refresh(): Promise<void> {
    const node = this._refreshButton.node as HTMLButtonElement;
    const focused = document.activeElement === node;
    node.disabled = true;
    node.classList.add('jp-mod-spinning');
    const started = Date.now();
    // a load in flight asked the server before the press: wait for it, then load again
    await this._loading;
    await this._reload();
    const rest = SPIN_MS - (Date.now() - started);
    if (rest > 0) {
      await new Promise(resolve => setTimeout(resolve, rest));
    }
    node.disabled = false;
    node.classList.remove('jp-mod-spinning');
    if (focused) {
      node.focus();
    }
  }

  /** The tabs of this window changed: its card follows them. */
  tabsChanged(): void {
    if (!this.isVisible) {
      return;
    }
    clearTimeout(this._tabsTimer);
    this._tabsTimer = window.setTimeout(() => void this._reload(), 300);
  }

  /** The + button: create an empty workspace; this window stays where it is. */
  async newWorkspace(): Promise<void> {
    try {
      const store = workspaces(this._settings);
      const form = await newWorkspaceDialog(
        (await store.list()).ids,
        this._translation
      );
      if (!form) {
        return;
      }
      // JupyterLab's own create saves over an existing workspace
      if ((await store.list()).ids.includes(form.name)) {
        throw new Error(`A workspace named ${form.name} exists`);
      }
      // given before the save: a poll during it would give the card another colour
      const colour = nextColour(this._last);
      this._last = this._colours[form.name] = colour;
      // a deleted workspace of this name left the position this page gave it
      delete this._positions[form.name];
      await store.save(form.name, { data: {}, metadata: { id: form.name } });
      // the new card shows in WORKSPACES, opened with the fold
      this._harmonica.select(0);
      this._openCards.add(`w:${form.name}`);
      keepCard(form.name, true);
      this._scrollTo = `w:${form.name}`;
      await this._store(form.name, {
        ...newRecord(form.purpose, colour),
        given: true
      });
    } catch (reason) {
      void showErrorMessage('New workspace', reason as Error);
    }
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    // the switch poll runs whether the panel shows or not: a request must reach a hidden window
    this._startSwitch();
    if (this.isVisible) {
      this._startPolling();
    }
  }

  protected onBeforeDetach(msg: Message): void {
    this._stopPolling();
    super.onBeforeDetach(msg);
  }

  protected onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    this._render();
    this._startPolling();
  }

  protected onAfterHide(msg: Message): void {
    this._stopPolling();
    super.onAfterHide(msg);
  }

  private get _settings() {
    return this._app.serviceManager.serverSettings;
  }

  private _startPolling(): void {
    if (this._timer) {
      return;
    }
    void this._reload();
    this._timer = window.setInterval(() => void this._reload(), POLL_MS);
  }

  private _stopPolling(): void {
    clearInterval(this._timer);
    clearTimeout(this._tabsTimer);
    this._timer = 0;
  }

  /** The switch poll ignores visibility; its first read loads the model a hidden panel never loads. */
  private _startSwitch(): void {
    if (this._switchTimer) {
      return;
    }
    if (!this._data) {
      void this._reload();
    }
    this._switchTimer = window.setInterval(
      () => void this._pollSwitch(),
      SWITCH_MS
    );
  }

  private _stopSwitch(): void {
    clearInterval(this._switchTimer);
    this._switchTimer = 0;
  }

  /** One reload at a time; a failed list keeps its last content under one line. */
  private _reload(): Promise<void> {
    if (!this._loading) {
      const changes = this._changes;
      this._loading = Promise.all([
        load(this._settings),
        // a failed or absent presence read keeps the workspaces the last one named
        elsewhere(this._settings, this._window).catch(() => this._kept)
      ])
        .then(([{ failed, ...data }, kept]) => {
          // an action that ended during this load is newer than its data
          if (changes !== this._changes) {
            return;
          }
          this._kept = kept ?? this._kept;
          this._data = { ...(this._data ?? EMPTY), ...data };
          this._last = data.last ?? this._last;
          this._error = failed.length
            ? `Reload failed: ${failed.join(', ')}`
            : '';
          this._giveColours();
          // with the records failed every position looks missing: giving
          // them would write over the stored order in every window
          if (data.records) {
            this._givePositions();
          }
          if (!this._pruned && data.workspaces) {
            this._pruneCards();
          }
          if (data.workspaces) {
            this._syncLayout(data.workspaces);
          }
        })
        .catch(reason => {
          this._error = `Reload failed: ${reason?.message ?? reason}`;
        })
        .then(() => {
          this._loading = null;
          this._render();
        });
    }
    return this._loading;
  }

  /**
   * Save the layout once when the names this window's live tabs save under
   * differ from the current workspace's saved keys: JupyterLab writes the
   * saved layout only on a layout change, so a renamed notebook's moved key
   * stays stale there until one; the save repoints the layout at the new key.
   */
  private _syncLayout(workspaces: ILoaded['workspaces']): void {
    const current = workspaces.find(w => w.metadata.id === this._current);
    if (!current) {
      return;
    }
    const saved = new Set(tabsOf(current.data).map(tab => tab.key));
    const live = new Set(
      this._liveTabs()
        .map(tab => tab.savedKey)
        .filter((key): key is string => !!key)
    );
    if (live.size === saved.size && [...live].every(key => saved.has(key))) {
      return;
    }
    const layout = (this._app.shell as any).saveLayout?.();
    if (layout) {
      // shortcut: LayoutRestorer.save is not on ILayoutRestorer, as its _widgets map is not; replace both when JupyterLab adds them
      Promise.resolve((this._restorer as any)?.save?.(layout)).catch(
        () => undefined
      );
    }
  }

  /**
   * Write this window's state - the live layout included - into its workspace
   * file; JupyterLab otherwise writes it 500 ms lazily and a navigation
   * cancels that write (DEF-PANEL-110-RIGHT-PANEL).
   */
  private async _saveState(id = this._current): Promise<void> {
    const layout = (this._app.shell as any).saveLayout?.();
    if (layout) {
      // shortcut: LayoutRestorer.save is not on ILayoutRestorer, as its _widgets map is not; replace both when JupyterLab adds them
      await Promise.resolve((this._restorer as any)?.save?.(layout)).catch(
        () => undefined
      );
    }
    if (!this._state) {
      return;
    }
    try {
      const data = await this._state.toJSON();
      await this._app.serviceManager.workspaces.save(id, {
        data,
        metadata: { id }
      });
    } catch {
      // a failed save must not block the switch
    }
  }

  /**
   * Read the switch requests for this window and apply them; one read at a
   * time, and none before the first load, so a tab request has a model to act on.
   */
  private _pollSwitch(): Promise<void> {
    if (this._switching) {
      return this._switching;
    }
    if (!this._data || this.isDisposed) {
      return Promise.resolve();
    }
    this._switching = switches(this._settings, this._window)
      .then(async requests => {
        this._applyPending();
        for (const request of requests) {
          await this._apply(request);
        }
      })
      .catch(() => undefined)
      .then(() => {
        this._switching = null;
      });
    return this._switching;
  }

  /** A workspace request switches this window as its card click does; a tab request activates that tab. */
  private async _apply({ workspace, tab }: ISwitch): Promise<void> {
    if (workspace && workspace !== this._current) {
      // the claim is the report: one server operation refuses a second window on the workspace
      if (!(await claim(this._settings, this._window, workspace))) {
        this._refuse(workspace, 'Switch to workspace');
        return;
      }
      // the tab path must survive the reload the switch makes
      keepPendingTab(tab ? { workspace, path: tab } : null);
      await this._saveState();
      document.location.href = this._url(workspace);
      return;
    }
    if (tab) {
      this._activate(tab);
    }
  }

  /** Activate the tab saved before this window switched, once its workspace shows it. */
  private _applyPending(): void {
    const saved = pendingTab();
    if (!saved) {
      return;
    }
    if (saved.workspace !== this._current) {
      keepPendingTab(null);
      return;
    }
    if (this._activate(saved.path)) {
      keepPendingTab(null);
    }
  }

  /** Activate the tab showing `path` in this window's workspace and select its row; whether it found one. */
  private _activate(path: string): boolean {
    const section = this._model()?.sections.find(s => s.current);
    const tab = section?.tabs.find(t => t.path === path);
    const widget = tab && this._live.get(tab.key);
    if (!section || !tab || !widget) {
      return false;
    }
    this._openCards.add(keyOf(section));
    keepCard(section.id, true);
    this._selected = `${keyOf(section)}/${tab.key}`;
    this._selectedTabs = [tab.key];
    this._app.shell.activateById(widget.id);
    this._render();
    return true;
  }

  /** A workspace without a stored colour takes the next one of the rotation. */
  private _giveColours(): void {
    const ids = (this._model()?.sections ?? [])
      .filter(s => !s.colour)
      .map(s => s.id);
    if (!ids.length) {
      return;
    }
    const { given, last } = assignColours(ids, {}, this._last);
    this._last = last;
    for (const id of Object.keys(given)) {
      this._colours[id] = given[id];
      // the server keeps the colour another window gave first; without the
      // server extension the colour lasts as long as this page
      patchMeta(this._settings, id, { colour: given[id], given: true })
        .then(record => {
          this._colours[id] = record.colour ?? given[id];
          this._render();
        })
        .catch(() => undefined);
    }
  }

  /** A workspace without a stored position takes the next one after the last, once, as a colour is given. */
  private _givePositions(): void {
    const sections = this._model()?.sections ?? [];
    // a position the server keeps, or one of a deleted workspace, leaves this page's own
    for (const id of Object.keys(this._positions)) {
      if (
        this._data?.records[id]?.position !== undefined ||
        !sections.some(s => s.id === id)
      ) {
        delete this._positions[id];
      }
    }
    const given = givePositions(sections);
    for (const id of Object.keys(given)) {
      this._positions[id] = given[id];
      // without the server extension the position lasts as long as this page
      patchMeta(this._settings, id, { position: given[id] }).catch(
        () => undefined
      );
    }
  }

  /** Drop the stored cards the first workspace list does not hold: hidden workspaces and this window's stay. */
  private _pruneCards(): void {
    this._pruned = true;
    const ids = new Set((this._model()?.sections ?? []).map(s => s.id));
    for (const key of Array.from(this._openCards)) {
      const id = key.slice('w:'.length);
      if (!ids.has(id)) {
        this._openCards.delete(key);
        keepCard(id, false);
      }
    }
  }

  private _model(data = this._data): IModel | null {
    if (!data) {
      return null;
    }
    // the sort needs a given position before its write comes back
    const records = { ...data.records };
    for (const [id, position] of Object.entries(this._positions)) {
      records[id] = { position, ...records[id] };
    }
    const model = buildModel({
      ...data,
      records,
      specs: this._app.serviceManager.kernelspecs.specs,
      current: this._current,
      liveTabs: this._liveTabs()
    });
    for (const s of model.sections) {
      if (!s.colour) {
        s.colour = this._colours[s.id] ?? null;
      }
    }
    return model;
  }

  /** The open tabs of this window, keyed as the layout restorer keys them; each tab has its own key (DQ-25). */
  private _liveTabs(): ITab[] {
    this._live.clear();
    const tabs: ITab[] = [];
    // shortcut: reads the layout restorer's private name map, as JupyterLab has no public lookup of the name a tab saves under; replace it when JupyterLab adds one
    const names = new Map<Widget, string>();
    for (const [name, tab] of (this._restorer as any)?._widgets ?? []) {
      names.set(tab, name);
    }
    for (const area of ['main', 'down']) {
      for (const widget of this._app.shell.widgets(area)) {
        const w = widget as any;
        const path: string | undefined =
          w.context?.path ?? w.sessionContext?.path;
        const terminal = w.content?.hasClass?.('jp-Terminal')
          ? w.content.session?.name
          : undefined;
        const console = widget.hasClass('jp-ConsolePanel');
        // a Launcher takes a launcher key, which the model leaves out (ACC-ACCORD-300-NO-LAUNCHER)
        const key = terminal
          ? `terminal:${terminal}`
          : w.content?.hasClass?.('jp-Launcher')
            ? `launcher:${widget.id}`
            : widget.hasClass('jp-NotebookPanel')
              ? `notebook:${path}`
              : console
                ? `console:${path}`
                : path
                  ? `document:${path}`
                  : // a web page tab takes the key its tracker saves it under (DEF-PANEL-90-MOVE-WEBTAB)
                    widget.hasClass(PAGE_CLASS)
                    ? `workspace-page:${w.content.id}`
                    : widget.hasClass('jp-ServerProxy')
                      ? `server-proxy:${w.content.id}`
                      : widget.hasClass('jp-Help')
                        ? `help-doc:${w.content.url}`
                        : // another tab the restorer saves takes its saved name; widget:<id> is left for a kind JupyterLab does not save
                          (names.get(widget) ?? `widget:${widget.id}`);
        // a terminal keeps its key: the model reads the terminal's name from it
        let own = key;
        for (let n = 2; !terminal && this._live.has(own); n++) {
          own = `${key}#${n}`;
        }
        this._live.set(own, widget);
        tabs.push({
          key: own,
          savedKey: names.get(widget),
          path,
          // a live page tab drags the address it shows, never its title (ACC-DRAG-320-PAGE-URL)
          url: widget.hasClass(PAGE_CLASS)
            ? pageUrl(widget)
            : widget.hasClass('jp-ServerProxy') || widget.hasClass('jp-Help')
              ? w.content.url
              : undefined,
          title: widget.title.label,
          name: console ? widget.title.label : undefined
        });
      }
    }
    this._watchScrolls();
    return tabs;
  }

  /** Watch each live tab's scroll box, so its place is kept while the tab is visible. */
  private _watchScrolls(): void {
    for (const [key, widget] of this._live) {
      const node = scrollNode(widget);
      if (node && !this._scrolled.has(node)) {
        this._scrolled.add(node);
        node.addEventListener('scroll', () => this._remember(key, widget), {
          passive: true,
          signal: this._scrolls.signal
        });
      }
    }
  }

  /** A tab of this window changed: keep the outgoing tab's place and show the incoming tab's, once. */
  private _currentChanged = (
    _: unknown,
    change: { oldValue: Widget | null; newValue: Widget | null }
  ): void => {
    if (this.isDisposed) {
      return;
    }
    this._liveTabs();
    if (change.oldValue) {
      const key = this._keyOf(change.oldValue);
      if (key) {
        this._remember(key, change.oldValue);
      }
    }
    this._markCurrent();
    this._releaseRow();
    if (change.newValue) {
      this._applyPendingPosition(change.newValue);
    }
  };

  /** Remember a tab's place, while the tab is visible: a hidden tab reads scrollTop 0. */
  private _remember(key: string, widget: Widget): void {
    if (widget.isDisposed || !widget.isVisible) {
      return;
    }
    const position = capture(widget);
    if (position) {
      remember(this._current, key, position);
    }
  }

  /** The key of the live tab drawing `widget`; undefined while the tab is not live. */
  private _keyOf(widget: Widget): string | undefined {
    for (const [key, live] of this._live) {
      if (live === widget) {
        return key;
      }
    }
    return undefined;
  }

  /**
   * Snapshot the tab still visible and every place the map kept, before the
   * page goes: a hidden tab reads no scroll and drops a write, so its place
   * comes from the map the visible-time listeners filled.
   */
  private _storePositions(): void {
    if (this.isDisposed) {
      return;
    }
    this._liveTabs();
    const positions = recall(this._current);
    for (const [key, widget] of this._live) {
      if (widget.isVisible || widget === this._app.shell.currentWidget) {
        const position = capture(widget);
        if (position) {
          positions[key] = position;
        }
      }
    }
    keep(this._current, positions);
  }

  /** Apply this workspace's stored places: at once to a tab that shows, on its first show to a hidden one. */
  private _restorePositions(): void {
    if (this.isDisposed) {
      return;
    }
    this._liveTabs();
    const current = this._app.shell.currentWidget;
    const stored = loadPositions(this._current);
    for (const [key, position] of Object.entries(stored)) {
      const widget = this._live.get(key);
      if (!widget) {
        continue;
      }
      if (widget === current || widget.isVisible) {
        // the document model may still load after app.restored: write now and
        // retry once it is ready, so the place is not lost on an empty widget
        applyWhenReady(widget, position);
      } else {
        this._pending.set(key, position);
      }
    }
  }

  /** Apply a place kept for a tab hidden when the workspace restored, once. */
  private _applyPendingPosition(widget: Widget): void {
    const key = this._keyOf(widget);
    const position = key ? this._pending.get(key) : undefined;
    if (key && position) {
      this._pending.delete(key);
      applyWhenReady(widget, position);
    }
  }

  private _watch(manager: IRunningSessions.IManager): void {
    if (manager.name === LANGUAGE_SERVERS) {
      manager.runningChanged.connect(() => this._render());
    }
  }

  private _languageServers(): IRunningSessions.IManager | undefined {
    return this._managers?.items().find(m => m.name === LANGUAGE_SERVERS);
  }

  private _toggleFilter(): void {
    this._filterShown = !this._filterShown;
    pressed(this._filterButton, this._filterShown);
    this._query = '';
    this._closedInFilter.clear();
    this._render();
    if (this._filterShown) {
      this.content.node
        .querySelector<HTMLInputElement>('.jp-WorkspaceManager-filterInput')
        ?.focus();
    }
  }

  private _setQuery(query: string): void {
    this._query = query;
    this._closedInFilter.clear();
    // the cards the filter opens show in WORKSPACES, opened with the fold
    if (query.trim()) {
      this._harmonica.select(0);
    }
    this._render();
  }

  private _isOpen(key: string): boolean {
    return this._query.trim()
      ? !this._closedInFilter.has(key)
      : this._openCards.has(key);
  }

  /** The triangle, or a header that does not switch: outside a filter it opens or closes its own card and leaves the rest; inside it, this card only. */
  private _toggle(key: string): void {
    if (this._query.trim()) {
      if (!this._closedInFilter.delete(key)) {
        this._closedInFilter.add(key);
      }
    } else {
      const open = !this._openCards.delete(key);
      if (open) {
        this._openCards.add(key);
      }
      keepCard(key.slice('w:'.length), open);
    }
    this._render();
  }

  private _render(): void {
    if (this.isDisposed) {
      return;
    }
    const model = this._model();
    const sections = model?.sections ?? [];
    this._sections = sections;
    const filtering = !!this._query.trim();
    const { cards, unmatched } = filterSections(
      sections,
      this._query,
      this._showHidden
    );
    const terminals = model?.terminals ?? [];
    const kernels = model?.kernels ?? [];
    const manager = this._languageServers();
    const servers = running(manager);
    // a terminal or kernel a workspace holds acts as in its card, this window's first
    const holder = (ids: string[]) =>
      sections.find(s => s.current && ids.includes(s.id)) ??
      sections.find(s => ids.includes(s.id)) ??
      null;
    const hidden = sections.filter(s => s.hidden).length;
    const now = Date.now();
    flushSync(() =>
      this._root.render(
        <>
          {this._filterShown && this._renderFilter()}
          {this._error && (
            <div className="jp-WorkspaceManager-error" role="status">
              {this._error}
            </div>
          )}
          <div
            className="jp-WorkspaceManager-list"
            onDragOver={e => this._dragOver(e)}
            onDrop={e => this._drop(e)}
          >
            {this._renderSection(
              'workspaces',
              'WORKSPACES',
              cards.length,
              <>
                {cards.map(card => this._renderCard(card, filtering, now))}
                {model && !filtering && !cards.length && (
                  <div className="jp-WorkspaceManager-empty">
                    {this._translation.__('No workspaces')}
                  </div>
                )}
                {filtering && !cards.length && (
                  <div className="jp-WorkspaceManager-empty">
                    {this._translation.__('Nothing matches')}
                  </div>
                )}
                {filtering && cards.length > 0 && unmatched > 0 && (
                  <div className="jp-WorkspaceManager-note">
                    {unmatched}{' '}
                    {unmatched === 1
                      ? this._translation.__('workspace')
                      : this._translation.__('workspaces')}{' '}
                    {this._translation.__('without a match')}{' '}
                    {unmatched === 1
                      ? this._translation.__('is')
                      : this._translation.__('are')}{' '}
                    {this._translation.__('not shown')}
                  </div>
                )}
                {hidden > 0 && (
                  <div className="jp-WorkspaceManager-note">
                    <eyeOffIcon.react
                      tag="span"
                      className="jp-WorkspaceManager-noteIcon"
                    />
                    {hidden} {this._translation.__('hidden')}{' '}
                    {hidden === 1
                      ? this._translation.__('workspace')
                      : this._translation.__('workspaces')}
                  </div>
                )}
              </>,
              'workspaces'
            )}
            {this._renderSection(
              'kernels',
              'KERNELS',
              kernels.length,
              kernels.map(k => this._kernelRow(holder(k.alsoIn), k, now, true)),
              'kernels'
            )}
            {this._renderSection(
              'terminals',
              'TERMINALS',
              terminals.length,
              terminals.map(t =>
                this._terminalRow(holder(t.alsoIn), t, now, true)
              ),
              'terminals'
            )}
            {this._renderSection(
              'servers',
              'LANGUAGE SERVERS',
              servers.length,
              manager ? this._managerRows(manager) : [],
              'servers'
            )}
          </div>
        </>
      )
    );
    // a new workspace has its card only after the reload that lists it
    const target =
      this._scrollTo &&
      this.content.node.querySelector(
        `[data-key="${CSS.escape(this._scrollTo)}"]`
      );
    // the fold pins the list it opens: the new card is scrolled to once it ends
    if (target && !this._harmonica.folding) {
      target.scrollIntoView?.({ block: 'nearest' });
      this._scrollTo = null;
    }
    this.node.style.setProperty(
      '--wm-gutter',
      `${this._probe.offsetWidth - this._probe.clientWidth}px`
    );
    // the selection lasts while its row is shown
    if (
      this._selected &&
      !this.content.node.querySelector(
        '.jp-WorkspaceManager-row.jp-mod-selected'
      )
    ) {
      this._selected = null;
    }
    // one tab stop per list: the row focused last, else the first
    this.content.node.querySelectorAll(LIST).forEach(list => {
      const rows = rowsOf(list);
      if (rows.length && !rows.some(r => r.tabIndex === 0)) {
        rows[0].tabIndex = 0;
      }
    });
  }

  private _renderFilter(): React.ReactElement {
    return (
      <div className="jp-WorkspaceManager-filter">
        <filterIcon.react
          tag="span"
          className="jp-WorkspaceManager-filterIcon"
        />
        <input
          className="jp-WorkspaceManager-filterInput"
          aria-label={this._translation.__(
            'Filter workspaces, tabs, terminals and kernels'
          )}
          placeholder={this._translation.__('Filter')}
          spellCheck={false}
          value={this._query}
          onChange={e => this._setQuery(e.target.value)}
        />
        {this._query && (
          <button
            className="jp-WorkspaceManager-iconButton"
            title={this._translation.__('Clear filter')}
            aria-label={this._translation.__('Clear filter')}
            onClick={e => {
              // read the field first: the render below removes this button
              const input = e.currentTarget
                .previousElementSibling as HTMLInputElement;
              this._setQuery('');
              input.focus();
            }}
          >
            <closeIcon.react tag="span" />
          </button>
        )}
      </div>
    );
  }

  /**
   * One section: the header carries the label, the count and its action buttons -
   * WORKSPACES adds a workspace and cleans up, TERMINALS and KERNELS clean up and shut
   * down, LANGUAGE SERVERS shuts down all; the open section shows its body, which
   * scrolls, and one of those three with nothing in it says so; a folded section shows
   * its body only while a pull or a fold moves it.
   */
  private _renderSection(
    key: string,
    label: string,
    n: number,
    body: React.ReactNode,
    shutdown?: 'servers' | 'terminals' | 'kernels' | 'workspaces'
  ): React.ReactElement {
    const i = (SECTION_KEYS as readonly string[]).indexOf(key);
    const open = i === this._open;
    return (
      <div
        key={key}
        className={`jp-WorkspaceManager-section${open ? ' jp-mod-open' : ''}`}
        data-section={key}
      >
        <div
          className="jp-WorkspaceManager-sectionHeader"
          role="button"
          tabIndex={0}
          aria-label={`${label} (${n})`}
          aria-expanded={open}
          onClick={() => this._harmonica.select(i)}
          onKeyDown={e => {
            if (
              e.target === e.currentTarget &&
              (e.key === 'Enter' || e.key === ' ')
            ) {
              e.preventDefault();
              this._harmonica.select(i);
            }
          }}
        >
          {/* the header is the one button; its caret is the reference's text glyph */}
          <span className="jp-WorkspaceManager-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="jp-WorkspaceManager-sectionLabel">{label}</span>
          <span className="jp-WorkspaceManager-sectionCount">({n})</span>
          {shutdown === 'workspaces' &&
            iconButton(
              addIcon,
              'New workspace',
              () => void this.newWorkspace(),
              false,
              undefined,
              undefined,
              true // pointerFocus
            )}
          {shutdown &&
            (shutdown === 'workspaces' ? (
              iconButton(
                eraserIcon,
                'Clean up workspaces',
                () => void this._cleanUp(),
                this._nothingToClean(),
                undefined,
                undefined,
                true // pointerFocus
              )
            ) : shutdown === 'servers' ? (
              iconButton(
                powerIcon,
                this._translation.__('Shut down all'),
                () => void this._shutDownSection(shutdown),
                !n,
                undefined,
                undefined,
                true // pointerFocus
              )
            ) : (
              <>
                {iconButton(
                  eraserIcon,
                  shutdown === 'terminals'
                    ? 'Clean up terminals'
                    : 'Clean up kernels',
                  () => void this._shutDownDetached(shutdown, true),
                  this._nothingToCleanBand(shutdown),
                  undefined,
                  undefined,
                  true // pointerFocus
                )}
                {iconButton(
                  powerIcon,
                  this._translation.__('Shut down'),
                  e => this._bandMenu(shutdown, e),
                  !n,
                  undefined,
                  undefined,
                  true // pointerFocus
                )}
              </>
            ))}
        </div>
        {(open || this._heights?.[i] !== undefined) && (
          <div className="jp-WorkspaceManager-sectionBody">
            {shutdown && shutdown !== 'workspaces' && !n ? (
              <div className="jp-WorkspaceManager-empty">
                {this._translation.__('No')} {label.toLowerCase()}
              </div>
            ) : (
              body
            )}
          </div>
        )}
      </div>
    );
  }

  private _renderCard(
    card: ICard,
    filtering: boolean,
    now: number
  ): React.ReactElement {
    const { section } = card;
    const key = keyOf(section);
    const open = this._isOpen(key);
    const id = section.id;
    const name = id;
    const classes = [
      'jp-WorkspaceManager-card',
      section.colour ? `jp-mod-${section.colour}` : '',
      section.colour ? 'jp-mod-coloured' : '',
      section.current ? 'jp-mod-current' : '',
      // not jp-mod-hidden: JupyterLab sets display: none on that class
      section.hidden ? 'jp-mod-hiddenWorkspace' : '',
      open ? 'jp-mod-open' : '',
      this._dropLine?.id === id
        ? `jp-mod-drop${this._dropLine.after ? 'After' : 'Before'}`
        : ''
    ];
    const when = age(section.lastModified, now, this._translation);
    // the header of another workspace's card switches to it; the triangle opens the card
    const switches = !section.current;
    const click = () =>
      switches ? void this._openWorkspace(section) : this._toggle(key);
    return (
      <div
        key={key}
        className={classes.filter(Boolean).join(' ')}
        data-key={key}
        data-workspace={id}
      >
        <div
          className={`jp-WorkspaceManager-cardHeader ${when.mod}`.trim()}
          role="button"
          tabIndex={0}
          aria-label={section.hidden ? `${name} hidden` : name}
          aria-expanded={switches ? undefined : open}
          title={section.purpose ? `${name}\n${section.purpose}` : name}
          draggable={!filtering}
          onDragStart={e => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            this._dragged = id;
          }}
          onDragEnd={() => {
            this._dragged = this._dropLine = null;
            this._render();
          }}
          onClick={click}
          onKeyDown={e => {
            if (
              e.target === e.currentTarget &&
              (e.key === 'Enter' || e.key === ' ')
            ) {
              e.preventDefault();
              click();
            }
          }}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            // a hidden card's header opens no menu
            if (!section.hidden) {
              const rect = e.currentTarget.getBoundingClientRect();
              // the context-menu key reports the header's centre and no button
              const pointer = e.button === 2;
              this._openMenu(
                section,
                pointer ? e.clientX : rect.left,
                pointer ? e.clientY : rect.bottom
              );
            }
          }}
        >
          <div className="jp-WorkspaceManager-headerLine">
            {caret(open, () => this._toggle(key))}
            <span className="jp-WorkspaceManager-name">{name}</span>
            {/* every open tab: the documents and the terminal tabs (ACC-ACCORD-276-NAME-COUNT) */}
            <span className="jp-WorkspaceManager-count">({card.total})</span>
            {section.hidden ? (
              <span className="jp-WorkspaceManager-hiddenWord">
                {this._translation.__('hidden')}
              </span>
            ) : (
              <span className="jp-WorkspaceManager-age">{when.label}</span>
            )}
            {/* the eye stays on every card; one that does not apply is disabled (DQ-12); its glyph shows the state, its name the action, aria-pressed the hidden state (ACC-HIDDEN-301-EYE-STATE) */}
            <span className="jp-WorkspaceManager-cardActions">
              {iconButton(
                section.hidden ? eyeOffIcon : eyeIcon,
                section.hidden ? 'Show workspace again' : 'Hide workspace',
                () => void this._store(id, { hidden: !section.hidden }),
                section.current,
                undefined,
                section.hidden
              )}
            </span>
          </div>
          {/* the purpose and the filter's shown-of-total line show while the card is open, its selection (DQ-17); with neither the line is absent, not empty */}
          {open && (section.purpose || filtering) && (
            <div className="jp-WorkspaceManager-headerLine">
              <span className="jp-WorkspaceManager-purpose">
                {section.purpose}
              </span>
              {filtering && (
                <span className="jp-WorkspaceManager-counts">
                  ({card.shown} {this._translation.__('of')} {card.total})
                </span>
              )}
            </div>
          )}
        </div>
        {open && (
          <div className="jp-WorkspaceManager-cardBody">
            {card.tabs.map(t => this._tabRow(section, t, now))}
            {card.terminals.map(t => this._terminalRow(section, t, now))}
            {card.total === 0 && (
              <div className="jp-WorkspaceManager-empty">
                {this._translation.__('No tabs, terminals or kernels')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /** The selection of the row `key` of the list `list`, whose tab has one of the keys `tabs`: the panel has one selected row (DQ-17). */
  private _selection(list: string, key: string, tabs = [key]) {
    const id = `${list}/${key}`;
    return {
      selected: this._selected === id,
      select: () => {
        if (this._selected !== id) {
          this._selected = id;
          this._selectedTabs = tabs;
          this._render();
        }
      }
    };
  }

  /** Move the current-row light to the rows of the shell's current widget without a render, so the scroll position stays (ACC-LISTS-273-CURRENT-ROW). */
  private _markCurrent(): void {
    this._liveTabs();
    const current = this._app.shell.currentWidget;
    for (const row of Array.from(
      this.content.node.querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row[data-row-key]'
      )
    )) {
      // a card row counts only in this window's card, as at render
      const card = row.closest('.jp-WorkspaceManager-card');
      const mine = !card || card.classList.contains('jp-mod-current');
      const isCurrent = mine && this._live.get(row.dataset.rowKey!) === current;
      row.classList.toggle('jp-mod-current', isCurrent);
      if (isCurrent) {
        row.setAttribute('aria-current', 'true');
      } else {
        row.removeAttribute('aria-current');
      }
    }
  }

  /** The selected row stays lit while the focus is on it or its tab is the current tab of this window (DQ-32), and until a press in the panel ends. */
  private _releaseRow(event?: FocusEvent): void {
    const row = this.content.node.querySelector(
      '.jp-WorkspaceManager-row.jp-mod-selected'
    );
    if (!row || this._pressed) {
      return;
    }
    // a tab the click opened may not be in the map yet
    this._liveTabs();
    // a browser window losing focus names no target and leaves the row the active element
    const focus = (event?.relatedTarget ??
      document.activeElement) as Node | null;
    if (row.contains(focus)) {
      return;
    }
    const current = this._app.shell.currentWidget;
    // the shell moves its current widget on the focus event, which follows this focusout
    const kept = this._selectedTabs.some(key => {
      const widget = this._live.get(key);
      return widget && (widget === current || widget.node.contains(focus));
    });
    if (!kept) {
      this._selected = null;
      this._render();
    }
  }

  /** The Detach from workspace entry of a card row. */
  private _detachAction(section: ISection, key: string): IRowAction {
    return {
      label: this._translation.__('Detach from workspace'),
      icon: launchIcon,
      execute: () => void this._closeTab(section, key, true)
    };
  }

  /** The Move to workspace entry of a card row: the workspaces of this panel but its own and the hidden ones. */
  private _moveAction(
    section: ISection,
    key: string,
    path?: string
  ): IRowAction {
    return {
      label: this._translation.__('Move to workspace'),
      icon: tabIcon,
      submenu: this._sections
        .filter(s => s.id !== section.id && !s.hidden)
        .map(target => ({
          label: target.id,
          execute: () => void this._moveTab(section, target, key, path)
        }))
    };
  }

  /**
   * The icon a saved tab without a path shows in its own window
   * (DEF-PANEL-95-WEBTAB-ICON): a page its saved image, else pageIcon, as
   * workspace-page:open sets it; a code viewer the icon of the file type of its
   * MIME type, else textEditorIcon, as code-viewer:open sets it;
   * a server-proxy or Help tab the icon a move copied into its entry, else the
   * globe of its address (ACC-LISTS-305-COPIED-ICON);
   * another kind by SAVED_ICONS, else fileIcon.
   */
  private _savedIcon(tab: ITab, workspace: string): LabIcon {
    const kind = tab.key.split(':')[0];
    if (COPIED_ICON_KINDS.has(kind)) {
      return copyable(tab.copiedIcon)
        ? new LabIcon({
            name: `jupyterlab-workspace-manager-extension:copied-icon:${workspace}:${tab.key}`,
            svgstr: tab.copiedIcon
          })
        : (globeOf(tab.url) ?? fileIcon);
    }
    if (kind === 'workspace-page') {
      return tab.icon ? imageIcon(tab.icon) : pageIcon;
    }
    if (kind === 'codeviewer') {
      const type = Array.from(this._app.docRegistry.fileTypes()).find(t =>
        t.mimeTypes.includes(tab.mimeType ?? '')
      );
      return type?.icon ?? textEditorIcon;
    }
    const name = SAVED_ICONS.get(kind);
    return name ? LabIcon.resolve({ icon: name }) : fileIcon;
  }

  private _tabRow(
    section: ISection,
    tab: ITabRow,
    now: number
  ): React.ReactElement {
    const live = section.current ? this._live.get(tab.key) : undefined;
    const fileIconOf = tab.path
      ? (this._app.docRegistry.getFileTypesForPath(tab.path)[0]?.icon ??
        fileIcon)
      : live?.title.icon instanceof LabIcon
        ? live.title.icon
        : this._savedIcon(tab, section.id);
    // a document with a running kernel shows its state dot; a document with more
    // than one kernel names each in its menu
    const kernels = tab.path
      ? section.kernels.filter(k => k.path === tab.path)
      : [];
    const kernel = kernels[0];
    // a document with a running kernel shows the kernel glyph beside its own icon (ACC-LISTS-277-KERNEL-GLYPH)
    const icon = kernel ? (
      <span className="jp-WorkspaceManager-rowIcon jp-WorkspaceManager-rowIcons">
        <fileIconOf.react tag="span" />
        <kernelIcon.react tag="span" />
      </span>
    ) : (
      fileIconOf
    );
    const when =
      kernel && kernel.lastActivity
        ? age(kernel.lastActivity, now, this._translation)
        : undefined;
    return row({
      key: tab.key,
      ...this._selection(keyOf(section), tab.key),
      current: live === this._app.shell.currentWidget,
      icon,
      label: tab.label,
      detail: [[[dirname(tab.path), CODE]]],
      title: tab.path ?? '',
      // a file drags its path for the advanced file browser's targets, a page its exact URL for this panel's terminal (ACC-DRAG-319-FILE-PATH, ACC-DRAG-320-PAGE-URL)
      drag: tab.path
        ? { mime: PATH_MIME, data: [tab.path] }
        : tab.url
          ? { mime: TEXT_MIME, data: tab.url }
          : undefined,
      when,
      state: kernel
        ? { word: kernel.state ?? 'unknown', dot: kernel.dotClass }
        : undefined,
      open: () => this._openRow(section, tab.key),
      menu: [
        {
          label: this._translation.__('Close tab'),
          icon: closeIcon,
          execute: () => void this._closeTab(section, tab.key)
        },
        ...(kernels.length ? [this._detachAction(section, tab.key)] : []),
        this._moveAction(section, tab.key, tab.path),
        ...kernels.map(k => ({
          label:
            kernels.length > 1
              ? `${this._translation.__('Shut down kernel')} ${k.label}`
              : this._translation.__('Shut down kernel'),
          icon: closeIcon,
          danger: true,
          execute: () => void this._shutDownKernel(k, section)
        }))
      ]
    });
  }

  private _terminalRow(
    /** null for a terminal in no workspace */
    section: ISection | null,
    t: ITerminalRow,
    now: number,
    /** a row of the TERMINALS section */
    listed = false
  ): React.ReactElement {
    const when = age(t.lastActivity, now, this._translation);
    const key = `terminal:${t.name}`;
    const inCard = section !== null && !listed;
    // a card row follows its shell widget only with its own workspace current
    const live = inCard && !section!.current ? undefined : this._live.get(key);
    const trans = this._translation;
    const tab = terminalTabName(t);
    // a listed row's holders once, in the model's order, so its badge and tooltip agree
    const held = listed
      ? this._sections.filter(s => t.alsoIn.includes(s.id))
      : null;
    const holders = (
      held ? held.map(s => s.id) : [section!.id, ...t.alsoIn]
    ).join(', ');
    const numbered = /^\d+$/.test(t.name);
    return row({
      key,
      ...this._selection(listed ? 'terminals' : keyOf(section!), key),
      current: live === this._app.shell.currentWidget,
      icon: terminalGlyph,
      // a TERMINALS row numbers a numbered terminal in a box badge; a named terminal keeps its
      // name, and a card row drops the label of a numbered terminal (ACC-TERM-285-NUMBER-BADGE, ACC-TERM-275-CARD-LABEL)
      label: listed
        ? numbered
          ? terminalBadge(t.name, held?.[0]?.colour ?? null)
          : terminalLabel(t.name)
        : numbered
          ? ''
          : terminalLabel(t.name),
      code: listed,
      process: tab ?? t.process,
      path: t.cwd,
      // a terminal drags its working directory as raw text (ACC-DRAG-321-TERM-CWD)
      drag: t.cwd ? { mime: TEXT_MIME, data: t.cwd } : undefined,
      title: lines(
        `terminal ${t.name}`,
        field(trans.__('Tab'), tab),
        field(trans.__('Process'), t.process),
        field(trans.__('Command'), t.command),
        field(trans.__('Path'), t.cwd),
        field(trans.__('Memory'), formatMemory(t.memory)),
        t.lastActivity
          ? trans.__(
              'Last activity: %1 (%2)',
              when.label,
              new Date(t.lastActivity).toLocaleString()
            )
          : trans.__('Last activity: %1', when.label),
        field(trans.__('Workspaces'), holders || trans.__('none'))
      ),
      when,
      // this window's row or a TERMINALS row activates the tab of its terminal;
      // a row of another workspace's card opens that workspace
      open: () =>
        section !== null && !listed && !section.current
          ? this._openRow(section, key)
          : void this._openTerminal(t.name),
      // a card row closes the tab or stops the terminal; the TERMINALS section
      // row of a terminal in no workspace only stops it
      menu: inCard
        ? [
            {
              label: this._translation.__('Close tab'),
              icon: closeIcon,
              execute: () => void this._closeTab(section!, key)
            },
            this._detachAction(section!, key),
            this._moveAction(section!, key),
            {
              label: this._translation.__('Stop terminal'),
              icon: closeIcon,
              danger: true,
              execute: () => void this._shutDownTerminal(t, section)
            }
          ]
        : [
            {
              label: this._translation.__('Shut down terminal'),
              icon: closeIcon,
              danger: true,
              execute: () => void this._shutDownTerminal(t, section)
            }
          ]
    });
  }

  private _kernelRow(
    /** null for a kernel in no workspace */
    section: ISection | null,
    k: IKernelRow,
    now: number,
    /** a row of the KERNELS section: its detail adds the memory and the CPU */
    listed = false
  ): React.ReactElement {
    const figures = this._data?.resources[k.id];
    const key = `kernel:${k.id}`;
    const tabs = [`notebook:${k.path}`, `console:${k.path}`];
    // a listed row's first holder in the model's order gives the icon its colour, as the terminal badge does (ACC-KERNEL-318-ICON-TINT)
    const held = listed
      ? this._sections.filter(s => k.alsoIn.includes(s.id))
      : null;
    const colour = held?.[0]?.colour ?? null;
    return row({
      key,
      ...this._selection(listed ? 'kernels' : keyOf(section!), key, tabs),
      icon:
        listed && k.alsoIn.length > 0 ? (
          <span
            className={`jp-WorkspaceManager-rowIcon jp-WorkspaceManager-kernelIcon${colour ? ` jp-mod-${colour} jp-mod-coloured` : ''}`}
          >
            <kernelIcon.react tag="span" />
          </span>
        ) : (
          kernelIcon
        ),
      // the file name of its notebook or console, the id with no session
      label: k.detail || k.id,
      code: !k.detail,
      // a kernel drags its session path as a path list (ACC-DRAG-322-KERNEL-PATH)
      drag: k.path ? { mime: PATH_MIME, data: [k.path] } : undefined,
      // the memory stands in the line, selected or not (ACC-KERNEL-281-ROW-MEMORY)
      memory: formatMemory(figures?.memory),
      state: { word: k.state ?? 'unknown', dot: k.dotClass },
      when: age(k.lastActivity, now, this._translation),
      // the path on a line of its own: the kernel type and the folder give way, the file name last (KERN-02)
      detail: [
        [
          [k.label, listed ? TYPE : SHRINK],
          ...(listed
            ? ([[formatCpu(figures?.cpu), '']] as [string, string][])
            : [])
        ],
        [
          [k.path.slice(0, k.path.lastIndexOf('/') + 1), FOLDER],
          [k.path && k.detail, CODE]
        ]
      ],
      title: lines(
        k.title,
        field(this._translation.__('Memory'), formatMemory(figures?.memory))
      ),
      open: () => {
        const session = this._data?.sessions.find(s => s.kernel?.id === k.id);
        if (
          section !== null &&
          (!listed || section.current || session?.type !== 'notebook')
        ) {
          this._openRow(section, ...tabs);
          return;
        }
        if (session?.type === 'notebook' && k.path) {
          void this._app.commands.execute('docmanager:open', { path: k.path });
        }
      },
      menu: [
        {
          label: this._translation.__('Shut down kernel'),
          icon: closeIcon,
          danger: true,
          execute: () => void this._shutDownKernel(k, section)
        }
      ]
    });
  }

  /** The rows of the LANGUAGE SERVERS section, with the actions the replaced panel gives them. */
  private _managerRows(m: IRunningSessions.IManager): React.ReactElement[] {
    const items = running(m);
    const rows = (
      list: IRunningSessions.IRunningItem[],
      key: string,
      child: boolean
    ): React.ReactElement[] =>
      ([] as React.ReactElement[]).concat(
        ...list.map((item, i) => {
          const icon = item.icon();
          // as the replaced panel: child rows take the default label
          const label = child
            ? undefined
            : typeof m.shutdownLabel === 'function'
              ? m.shutdownLabel(item)
              : m.shutdownLabel;
          return [
            row({
              key: `${key}:${i}`,
              ...this._selection('servers', `${key}:${i}`),
              icon:
                typeof icon === 'string' ? (
                  <img
                    className="jp-WorkspaceManager-rowIcon"
                    src={icon}
                    alt=""
                  />
                ) : (
                  icon
                ),
              label: item.label(),
              detail: [[[item.detail?.() ?? '', '']]],
              title: languageServerTitle(item),
              child,
              shutdown: item.shutdown && {
                label: label ?? this._translation.__('Shut Down'),
                icon: m.shutdownItemIcon ?? closeIcon,
                execute: () => item.shutdown!()
              },
              open: () => item.open?.()
            }),
            ...rows(item.children ?? [], `${key}:${i}`, true)
          ];
        })
      );
    return rows(items, m.name, false);
  }

  /** The KERNELS and TERMINALS band power button: Shut down all, or only the items no workspace holds (ACC-ACCORD-292-SHUTDOWN-MENU). */
  private _bandMenu(kind: 'terminals' | 'kernels', e: React.MouseEvent): void {
    const detached = (this._model()?.[kind] ?? []).some(
      x => x.alsoIn.length === 0
    );
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    actionMenu([
      {
        label: this._translation.__('Shut down all'),
        icon: powerIcon,
        danger: true,
        execute: () => void this._shutDownSection(kind)
      },
      {
        label: this._translation.__('Shut down detached'),
        icon: powerIcon,
        danger: true,
        enabled: detached,
        execute: () => void this._shutDownDetached(kind)
      }
    ]).open(rect.left, rect.bottom);
  }

  /**
   * Shut down every terminal or kernel of a section that no workspace holds, asking once
   * (ACC-ACCORD-292-SHUTDOWN-MENU); clean keeps the busy and starting kernels, whose work
   * would be lost (ACC-PANEL-327-TERM-CLEAN, ACC-PANEL-328-KERNEL-CLEAN).
   */
  private async _shutDownDetached(
    kind: 'terminals' | 'kernels',
    clean = false
  ): Promise<void> {
    const rows = this._model();
    const n =
      kind === 'terminals'
        ? (rows?.terminals ?? []).filter(t => t.alsoIn.length === 0).length
        : (rows?.kernels ?? []).filter(
            k => k.alsoIn.length === 0 && (!clean || k.state === 'idle')
          ).length;
    if (!n) {
      return;
    }
    const word = kind === 'terminals' ? 'terminal' : 'kernel';
    if (
      !(await confirm(
        'Shut down detached?',
        `Shut down ${n} detached ${word}${n === 1 ? '' : 's'}.`,
        'Shut down detached'
      ))
    ) {
      return;
    }
    await this._act(async () => {
      // what runs now: an item may have been attached while the dialog was open
      const { failed, ...data } = await load(this._settings);
      if (failed.length) {
        throw new Error(
          `Nothing was shut down. Reload failed: ${failed.join(', ')}`
        );
      }
      const model = this._model({ ...EMPTY, ...data })!;
      if (kind === 'terminals') {
        await Promise.all(
          model.terminals
            .filter(x => x.alsoIn.length === 0)
            .map(x => this._app.serviceManager.terminals.shutdown(x.name))
        );
      } else {
        await Promise.all(
          model.kernels
            .filter(
              x => x.alsoIn.length === 0 && (!clean || x.state === 'idle')
            )
            .map(x => this._app.serviceManager.kernels.shutdown(x.id))
        );
      }
    });
  }

  /** Whether a clean-up of a band would stop nothing: no detached terminal, no detached idle kernel (ACC-PANEL-327-TERM-CLEAN, ACC-PANEL-328-KERNEL-CLEAN). */
  private _nothingToCleanBand(kind: 'terminals' | 'kernels'): boolean {
    const rows = this._model();
    return kind === 'terminals'
      ? !(rows?.terminals ?? []).some(t => t.alsoIn.length === 0)
      : !(rows?.kernels ?? []).some(
          k => k.alsoIn.length === 0 && k.state === 'idle'
        );
  }

  /** Shut down every item of one of the sections below WORKSPACES, asking once. */
  private async _shutDownSection(
    kind: 'servers' | 'terminals' | 'kernels'
  ): Promise<void> {
    if (kind === 'servers') {
      const manager = this._languageServers();
      const text =
        typeof manager?.shutdownAllConfirmationText === 'function'
          ? manager.shutdownAllConfirmationText()
          : manager?.shutdownAllConfirmationText;
      if (
        !(await confirm(
          'Shut down all?',
          text ?? 'Shut down all language servers.',
          'Shut down all'
        ))
      ) {
        return;
      }
      await this._act(async () => manager?.shutdownAll());
      return;
    }
    const n = this._model()?.[kind].length ?? 0;
    const word = kind === 'terminals' ? 'terminal' : 'kernel';
    if (
      !(await confirm(
        'Shut down all?',
        `Shut down ${n} ${word}${n === 1 ? '' : 's'}.`,
        'Shut down all'
      ))
    ) {
      return;
    }
    await this._act(async () => {
      // what runs now: a terminal or kernel may have ended while the dialog was open
      const { failed, ...data } = await load(this._settings);
      if (failed.length) {
        throw new Error(
          `Nothing was shut down. Reload failed: ${failed.join(', ')}`
        );
      }
      const model = this._model({ ...EMPTY, ...data })!;
      if (kind === 'terminals') {
        await Promise.all(
          model.terminals.map(x =>
            this._app.serviceManager.terminals.shutdown(x.name)
          )
        );
      } else {
        await Promise.all(
          model.kernels.map(x =>
            this._app.serviceManager.kernels.shutdown(x.id)
          )
        );
      }
    });
  }

  /** The WORKSPACES clear-console button: delete the other workspaces and empty this one, asking once (DQ-22). */
  private async _cleanUp(): Promise<void> {
    const model = this._model();
    if (!model) {
      return;
    }
    // fresh: a window may have shown a workspace since the last poll
    const kept = await elsewhere(this._settings, this._window).catch(
      () => this._kept
    );
    if (kept === null) {
      void showErrorMessage(
        'Clean up workspaces',
        'Clean up needs the server extension: it cannot tell which workspaces another window shows.'
      );
      return;
    }
    // the rows the dialog shows are the delete set: a workspace created after it is never deleted
    const rows = cleanRows(model.sections, kept);
    if (!(await cleanUpDialog(rows, this._translation))) {
      return;
    }
    await this._act(async () => {
      // what stands now: a workspace may have been deleted while the dialog was open
      const { failed, ...data } = await load(this._settings);
      if (failed.length) {
        throw new Error(
          `Nothing was cleaned up. Reload failed: ${failed.join(', ')}`
        );
      }
      // a workspace another window opened during the dialog is kept too; an absent server
      // keeps the first list's workspaces
      const fresh = await elsewhere(this._settings, this._window).catch(
        () => kept
      );
      const shown = fresh ?? kept;
      const now = this._model({ ...EMPTY, ...data })!;
      const there = new Set(now.sections.map(section => section.id));
      // only the confirmed deletions, still there and shown by no window now; one it marked kept stays
      for (const row of rows) {
        if (
          row.outcome === 'deleted' &&
          there.has(row.id) &&
          !shown.includes(row.id)
        ) {
          await workspaces(this._settings).remove(row.id);
        }
      }
      // this window's workspace stays and is emptied: its processes end, then its tabs close
      // (processes first: a tab closed after its kernel shutdown ends it again, and that 404 would show)
      const current = now.sections.find(section => section.current);
      await Promise.all(
        (current?.terminals ?? []).map(t =>
          this._app.serviceManager.terminals
            .shutdown(t.name)
            .catch(() => undefined)
        )
      );
      await Promise.all(
        (current?.kernels ?? []).map(k =>
          this._app.serviceManager.kernels.shutdown(k.id).catch(() => undefined)
        )
      );
      await this._languageServers()?.shutdownAll();
      await this._app.commands.execute('application:close-all');
    });
  }

  /** Whether clean-up would change nothing: no workspace to delete, this one empty, no language server. */
  private _nothingToClean(): boolean {
    return (
      !cleanable(cleanRows(this._model()?.sections ?? [], this._kept)) &&
      !running(this._languageServers()).length
    );
  }

  private _openMenu(section: ISection, x: number, y: number): void {
    const id = section.id;
    const shown = this._shown();
    const i = shown.findIndex(s => s.id === id);
    const menu: Menu = workspaceMenu(
      section.colour,
      section.current,
      {
        open: () => void this._openWorkspace(section),
        openInNewTab: () => void this._openWorkspace(section, true),
        closeAll: () => void this._closeAll(section),
        describe: () => void this._describe(section),
        colour: colour => void this._store(id, { colour }),
        hide: () => void this._store(id, { hidden: true }),
        moveUp: i > 0 ? () => void this._move(id, i - 1) : undefined,
        moveDown:
          i < shown.length - 1 ? () => void this._move(id, i + 1) : undefined,
        delete: () => void this._delete(section)
      },
      this._translation
    );
    menu.open(x, y);
  }

  /** Show the refusal of an action on a workspace that another browser window shows, or of a destructive action while presence is unknown. */
  private _refuse(id: string, action: string, absent = false): void {
    void showErrorMessage(
      absent ? 'Workspace manager' : 'Workspace open in another window',
      absent
        ? `${action} is refused: the server extension is not available, so the panel cannot tell which workspaces another window shows.`
        : `${action} is refused: workspace ${id} is open in another browser window. Close it there first. A window closed less than 90 seconds ago still counts as open.`
    );
  }

  /**
   * Refuse an action on a workspace that another browser window shows; with the server
   * extension absent presence is unknown, so a destructive action refuses and Open proceeds.
   */
  private async _refused(
    id: string,
    action: string,
    destructive = false
  ): Promise<boolean> {
    const shown = await elsewhere(this._settings, this._window);
    // a null answer is the absent server, which cannot tell which window shows what
    if (shown === null ? !destructive : !shown.includes(id)) {
      return false;
    }
    this._refuse(id, action, shown === null);
    return true;
  }

  private _url(id: string): string {
    return PageConfig.getUrl({
      mode: 'multiple-document',
      workspace: id,
      treePath: ''
    });
  }

  private async _openWorkspace(
    section: ISection,
    newTab = false
  ): Promise<void> {
    const id = section.id;
    if (section.current) {
      return;
    }
    await this._act(async () => {
      if (
        await this._refused(
          id,
          newTab ? 'Open in new browser tab' : 'Open workspace'
        )
      ) {
        return;
      }
      if (newTab) {
        window.open(this._url(id), '_blank');
      } else {
        await this._saveState();
        document.location.href = this._url(id);
      }
    });
  }

  /** A row click: activate the tab here, or open the row's workspace. */
  private _openRow(section: ISection, ...keys: string[]): void {
    if (!section.current) {
      void this._openWorkspace(section);
      return;
    }
    const widget = keys.map(k => this._live.get(k)).find(Boolean);
    if (widget) {
      this._app.shell.activateById(widget.id);
    }
  }

  /** The terminal session of a shell widget, while its connection is open. */
  private _openSession(widget: Widget): { name?: string } | undefined {
    const w = widget as any;
    const session = w.content?.hasClass?.('jp-Terminal')
      ? w.content.session
      : undefined;
    // JupyterLab disposes the connection when terminado says the process ended
    return session && !session.isDisposed ? session : undefined;
  }

  /** The tab of a terminal: the one a row opened, else one this window still has open. */
  private _terminalView(name: string): Widget | undefined {
    const kept = this._terminalTab.get(name);
    if (kept && !kept.isDisposed && this._openSession(kept)?.name === name) {
      return kept;
    }
    this._terminalTab.delete(name);
    for (const area of ['main', 'down']) {
      for (const widget of this._app.shell.widgets(area)) {
        if (this._openSession(widget)?.name === name) {
          return widget;
        }
      }
    }
    return undefined;
  }

  /** A terminal row: a call while the tab opens joins that opening, because the shell holds no tab to find yet. */
  private _openTerminal(name: string): Promise<void> {
    let opening = this._opening.get(name);
    if (!opening) {
      opening = this._showTerminal(name).finally(() =>
        this._opening.delete(name)
      );
      this._opening.set(name, opening);
    }
    return opening;
  }

  /** Activate the tab of a terminal, or open one. */
  private async _showTerminal(name: string): Promise<void> {
    // terminal:open cannot be used: it would activate the tab of an ended
    // connection that a new terminal of the same name has taken over from
    const view =
      this._terminalView(name) ??
      ((await this._app.commands.execute('terminal:create-new', {
        name
      })) as Widget | undefined);
    if (view) {
      this._terminalTab.set(name, view);
      this._app.shell.activateById(view.id);
    }
  }

  /** Clear a workspace: stop every terminal it lists and every kernel of its documents, and close its tabs, or empty another workspace's saved layout; a tab JupyterLab's unsaved-document prompt keeps open keeps its process (ACC-ACCORD-284-CLEAR-WORKSPACE). */
  private async _closeAll(section: ISection): Promise<void> {
    const id = section.id;
    await this._act(async () => {
      if (
        !section.current &&
        (await this._refused(id, 'Clear workspace', true))
      ) {
        return;
      }
      const items = [
        ...section.terminals.map(t => `terminal ${t.name}`),
        ...section.kernels.map(k => `kernel ${k.label}`)
      ];
      if (items.length) {
        const list =
          items.length === 1
            ? items[0]
            : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
        if (
          !(await confirm(
            `Clear workspace ${id}?`,
            `The workspace holds ${list}. Clearing it stops ${items.length === 1 ? 'it' : 'them'} and closes every tab.`,
            'Clear workspace'
          ))
        ) {
          return;
        }
      }
      const stop = (terminals: ITerminalRow[], kernels: IKernelRow[]) =>
        Promise.all(
          [
            ...terminals.map(t =>
              this._app.serviceManager.terminals.shutdown(t.name)
            ),
            ...kernels.map(k => this._app.serviceManager.kernels.shutdown(k.id))
          ].map(shutdown => shutdown.catch(() => undefined))
        );
      if (section.current) {
        this._liveTabs();
        // the manager owns the documents: every other tab closes as close-all closes it
        for (const widget of this._live.values()) {
          if (!this._docManager.contextForWidget(widget)) {
            widget.close();
          }
        }
        // the prompt answers before this returns: a Discarded document is disposed
        // here, a Cancelled one stays live, so the filter below keeps its kernel
        await this._docManager.closeAll();
        this._liveTabs();
        // a process a tab's own close ended answers 404, which the catch covers
        await stop(
          section.terminals.filter(t => !this._live.has(`terminal:${t.name}`)),
          section.kernels.filter(
            k =>
              !this._live.has(`notebook:${k.path}`) &&
              !this._live.has(`console:${k.path}`)
          )
        );
      } else {
        // another workspace holds no tab here: its processes end before its layout empties
        // (a tab closed after its kernel shutdown ends it again, and that 404 would show)
        await stop(section.terminals, section.kernels);
        const store = workspaces(this._settings);
        const ws = await store.fetch(id);
        // jupyterlab_server answers a deleted workspace with an empty one; saving it would recreate it
        if (!ws.metadata.last_modified) {
          throw new Error(`Workspace ${id} no longer exists`);
        }
        const keys = tabsOf(ws.data).map(t => t.key);
        await store.save(id, withoutTabs(ws, keys));
      }
    });
  }

  /** Close a tab; `detach` keeps its terminal or kernel running, whatever the lab's settings say. */
  private async _closeTab(
    section: ISection,
    key: string,
    detach = false
  ): Promise<void> {
    if (section.current) {
      const live = this._live.get(key);
      if (live && detach) {
        keepRunning(live);
      }
      // as JupyterLab's own close: only the last view of an unsaved document asks
      live?.close();
      return;
    }
    const id = section.id;
    await this._act(async () => {
      if (
        await this._refused(
          id,
          detach ? 'Detach from workspace' : 'Close tab',
          true
        )
      ) {
        return;
      }
      const store = workspaces(this._settings);
      const ws = await store.fetch(id);
      if (!ws.metadata.last_modified) {
        throw new Error(`Workspace ${id} no longer exists`);
      }
      await store.save(id, withoutTabs(ws, [key]));
    });
  }

  /**
   * Move a tab to another workspace. The target is saved first: a failure between
   * the two writes leaves the tab in both workspaces, never in neither. This window
   * takes the tab live, because its next autosave overwrites a saved-layout write.
   */
  private async _moveTab(
    source: ISection,
    target: ISection,
    key: string,
    path?: string
  ): Promise<void> {
    const action = 'Move to workspace';
    await this._act(async () => {
      if (
        (await this._refused(target.id, action, true)) ||
        (await this._refused(source.id, action, true))
      ) {
        return;
      }
      const live = source.current ? this._live.get(key) : undefined;
      if ((live as any)?.context?.model?.dirty) {
        throw new Error(
          `${action} is refused: the document has unsaved changes. Save it first.`
        );
      }
      const store = workspaces(this._settings);
      const from = await store.fetch(source.id);
      const tabs = tabsOf(from.data);
      // a live document's key is not always its saved key: `document:a.txt` saves as `editor:a.txt`; a path of two saved tabs names neither;
      // a live document is a tab a document factory opened, so only a saved entry with a factory can be it; a notebook has a live key of its own (DEF-PANEL-81-MOVE-EDITOR)
      const byPath = tabs.filter(
        t =>
          path !== undefined &&
          t.path === path &&
          !t.key.startsWith('notebook:') &&
          (from.data[t.key] as any)?.data?.factory !== undefined
      );
      // two live documents of one path may share one saved tab until the autosave, so the path names neither (DEF-PANEL-82-MOVE-VIEW)
      const views = [...this._live].filter(
        ([k, w]) =>
          k.startsWith('document:') &&
          ((w as any).context?.path ?? (w as any).sessionContext?.path) === path
      ).length;
      // a notebook or a console keeps its saved key as its live key, so a miss means it is not saved yet (DEF-PANEL-83-MOVE-OWNKEY)
      const saved =
        tabs.find(t => t.key === key) ??
        (key.startsWith('document:') && byPath.length === 1 && views === 1
          ? byPath[0]
          : undefined);
      if (!saved) {
        throw new Error(
          key.startsWith('widget:')
            ? `${action} is refused: JupyterLab does not save this kind of tab in a workspace, so it cannot be moved. Open it again in the other workspace.`
            : `${action} is refused: workspace ${source.id} has not saved this tab yet, or has saved more than one tab of its file. Try again in a moment, or close the other tab of the file.`
        );
      }
      const entry = from.data[saved.key];
      if (!target.current) {
        const to = await store.fetch(target.id);
        if (!to.metadata.last_modified) {
          throw new Error(`Workspace ${target.id} no longer exists`);
        }
        // a live web page tab's favicon is in no saved entry: the target's cards draw a copy of its live icon (ACC-LISTS-305-COPIED-ICON)
        const icon =
          live?.title.icon instanceof LabIcon
            ? live.title.icon.svgstr
            : undefined;
        const moved =
          live && COPIED_ICON_KINDS.has(saved.key.split(':')[0])
            ? {
                ...(entry as any),
                data: {
                  ...(entry as any).data,
                  copiedIcon: copyable(icon) ? icon : undefined
                }
              }
            : entry;
        // withTab keeps a target that holds the key, and a server-proxy app has one fixed key: the copy goes into the target's data first
        await store.save(
          target.id,
          withTab(
            moved === entry
              ? to
              : { ...to, data: { ...to.data, [saved.key]: moved } },
            saved.key,
            moved
          )
        );
      } else if (saved.key.startsWith('terminal:')) {
        await this._openTerminal(saved.key.slice('terminal:'.length));
      } else {
        const web = WEB_OPEN.get(saved.key.split(':')[0]);
        // a console saves no factory: it opens as the layout restorer opens it, by console:create with its saved data; a web page tab by its restore command
        const opened = web
          ? await this._app.commands.execute(web, (entry as any).data)
          : saved.path &&
            (saved.key.startsWith('console:')
              ? await this._app.commands.execute(
                  'console:create',
                  (entry as any).data
                )
              : (entry as any).data?.factory &&
                (await this._app.commands.execute('docmanager:open', {
                  path: saved.path,
                  factory: (entry as any).data.factory
                })));
        if (!opened) {
          throw new Error(`This window cannot open ${saved.key}.`);
        }
      }
      if (source.current) {
        await this._closeTab(source, key, true);
      } else {
        await store.save(source.id, withoutTabs(from, [saved.key]));
      }
    });
  }

  private async _delete(section: ISection): Promise<void> {
    const id = section.id;
    await this._act(async () => {
      // this window closes its own workspace: a stale record of it - a prior page
      // of this tab stays listed until its heartbeat expires - cannot refuse it
      if (
        !section.current &&
        (await this._refused(id, 'Delete workspace', true))
      ) {
        return;
      }
      await removeWorkspace(this._settings, id);
      this._openCards.delete(`w:${id}`);
      keepCard(id, false);
      // this window's own workspace goes too: it falls back to the default one,
      // which JupyterLab recreates on the next request when its file is gone
      if (section.current) {
        document.location.href = this._url('default');
      }
    });
  }

  private async _describe(section: ISection): Promise<void> {
    // shortcut: the ids are the last reload's, so a workspace created elsewhere
    // since is overwritten by the rename; take a fresh list if that matters
    const form = await descriptionDialog(
      section.id,
      section.purpose,
      (this._model()?.sections ?? []).map(s => s.id),
      this._translation
    );
    if (form === null) {
      return;
    }
    const purpose = form.purpose.trim();
    if (form.name === section.id) {
      await this._store(section.id, { purpose });
      return;
    }
    const to = form.name;
    await this._act(async () => {
      // this window's own workspace is present under this window, so it renames here
      if (
        !section.current &&
        (await this._refused(section.id, 'Rename workspace', true))
      ) {
        return;
      }
      await renameWorkspace(this._settings, section.id, to);
      // the whole record moves with the workspace; the server drops the old id's
      // record once its file is gone
      const record = this._data?.records[section.id] ?? {};
      await patchMeta(this._settings, to, { ...record, purpose });
      if (this._openCards.delete(`w:${section.id}`)) {
        this._openCards.add(`w:${to}`);
        keepCard(to, true);
      }
      keepCard(section.id, false);
      // this window's workspace parameter must name the new id, or its next
      // layout save writes the old workspace back
      if (section.current) {
        await this._saveState(to);
        document.location.href = this._url(to);
      }
    });
  }

  private async _shutDownTerminal(
    t: ITerminalRow,
    section: ISection | null
  ): Promise<void> {
    // a TERMINALS row carries every holder, a card row the others only
    const others = t.alsoIn.filter(id => id !== section?.id);
    // the dialog names every holder but this window's workspace
    const names = t.alsoIn.filter(
      id => !(section?.current && id === section.id)
    );
    if (
      others.length &&
      !(await confirm(
        `Shut down terminal ${t.name}?`,
        holdersSentence(names, others, 'terminal'),
        'Shut down'
      ))
    ) {
      return;
    }
    await this._act(async () => {
      await this._app.serviceManager.terminals.shutdown(t.name);
    });
  }

  private async _shutDownKernel(
    k: IKernelRow,
    section: ISection | null
  ): Promise<void> {
    // a KERNELS row carries every holder, a card row the others only
    const others = k.alsoIn.filter(id => id !== section?.id);
    // the dialog names every holder but this window's workspace
    const names = k.alsoIn.filter(
      id => !(section?.current && id === section.id)
    );
    if (
      others.length &&
      !(await confirm(
        `Shut down kernel ${k.label}?`,
        holdersSentence(names, others, 'kernel'),
        'Shut down'
      ))
    ) {
      return;
    }
    await this._act(() => this._app.serviceManager.kernels.shutdown(k.id));
  }

  /** Store a record change; the card shows it at once. */
  private async _store(
    id: string,
    change: IRecord & { given?: boolean }
  ): Promise<void> {
    await this._act(async () => {
      const record = await patchMeta(this._settings, id, change);
      if (this._data) {
        this._data.records = { ...this._data.records, [id]: record };
      }
      this._render();
    });
  }

  /** The cards the panel shows, in order. */
  private _shown(all = this._model()?.sections ?? []): ISection[] {
    return filterSections(all, this._query, this._showHidden).cards.map(
      c => c.section
    );
  }

  /** A card dragged over the list: the line goes above or below the card under the pointer and stays over a gap. */
  private _dragOver(e: React.DragEvent): void {
    // a file or a text dragged in is no card
    if (!this._dragged) {
      return;
    }
    e.preventDefault();
    const card = (e.target as Element).closest<HTMLElement>('[data-workspace]');
    if (!card) {
      return;
    }
    const rect = card.getBoundingClientRect();
    const line = {
      id: card.dataset.workspace!,
      after: e.clientY > rect.top + rect.height / 2
    };
    if (line.id !== this._dropLine?.id || line.after !== this._dropLine.after) {
      this._dropLine = line;
      this._render();
    }
  }

  /** The drop: the dragged card moves to the line. */
  private _drop(e: React.DragEvent): void {
    const id = this._dragged;
    const line = this._dropLine;
    this._dragged = this._dropLine = null;
    if (!id || !line) {
      return;
    }
    e.preventDefault();
    const shown = this._shown();
    const to =
      shown.filter(s => s.id !== id).findIndex(s => s.id === line.id) +
      Number(line.after);
    if (line.id !== id && to !== shown.findIndex(s => s.id === id)) {
      void this._move(id, to);
    } else {
      this._render();
    }
  }

  /** Move a card to index `to` of the cards shown, counted without it; the panel shows the new order at once. */
  private async _move(id: string, to: number): Promise<void> {
    const all = this._model()?.sections ?? [];
    const writes = Object.entries(moved(all, this._shown(all), id, to));
    if (this._data) {
      const records = { ...this._data.records };
      for (const [w, position] of writes) {
        records[w] = { ...records[w], position };
      }
      this._data.records = records;
    }
    // a load that started before the move must not bring the old positions back
    this._changes += 1;
    this._render();
    await this._act(() =>
      Promise.all(
        writes.map(([w, position]) =>
          patchMeta(this._settings, w, { position })
        )
      )
    );
  }

  /** Run a user action, report its failure, then reload with a load that starts after it. */
  private async _act(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (reason) {
      void showErrorMessage('Workspace manager', reason as Error);
    }
    this._changes += 1;
    await this._loading;
    await this._reload();
  }

  private _app: JupyterFrontEnd;
  private _docManager: IDocumentManager;
  private _current: string;
  private _window: string;
  private _managers: IRunningSessionManagers | null;
  private _restorer: ILayoutRestorer | null;
  private _state: IStateDB | null;
  private _translation: TranslationBundle;
  private _root: Root;
  private _filterButton: Widget;
  private _hiddenButton: Widget;
  private _refreshButton: Widget;
  private _sectionAdded = new Signal<this, ISectionEntry>(this);

  private _data: ILoaded | null = null;
  /** the workspaces of the last render, in panel order */
  private _sections: ISection[] = [];
  private _error = '';
  private _loading: Promise<void> | null = null;
  /** user actions ended so far; a load started before the last one is discarded */
  private _changes = 0;
  private _timer = 0;
  private _switchTimer = 0;
  /** the switch read in flight: one at a time */
  private _switching: Promise<void> | null = null;
  private _tabsTimer = 0;
  /** the open tab of each key of this window */
  private _live = new Map<string, Widget>();
  /** the pagehide that stores the file positions: one reference to remove it in dispose */
  private _pagehide = (): void => this._storePositions();
  /** the scroll listeners of the live tabs, all removed in dispose */
  private _scrolls = new AbortController();
  /** the scroll boxes already listening, so a later render attaches nothing */
  private _scrolled = new WeakSet<Element>();
  /** places of tabs hidden when the workspace restored, applied when each first shows */
  private _pending = new Map<string, IPosition>();
  /** the tab a terminal row opened or activated, by terminal name */
  private _terminalTab = new Map<string, Widget>();
  /** the terminal row calls in flight, by terminal name */
  private _opening = new Map<string, Promise<void>>();
  /** colours this page gave to workspaces whose record has none */
  private _colours: { [id: string]: Colour } = {};
  /** the colour given last, as the server keeps it for every window */
  private _last: Colour | null = null;
  /** the workspaces other windows showed in the last 90 s: clean-up keeps them (DQ-22) */
  private _kept: string[] = [];
  /** positions this page gave to workspaces whose record has none */
  private _positions: { [id: string]: number } = {};
  /** the workspace whose card is dragged, and the line where it lands */
  private _dragged: string | null = null;
  private _dropLine: { id: string; after: boolean } | null = null;

  /** the open section, by its index in SECTION_KEYS, as the harmonica drew it last */
  private _open = storedSection();
  /** the lists a pull or a fold moves, by index, in px; null at rest */
  private _heights: Record<number, number> | null = null;
  private _harmonica: Harmonica;
  /** a hidden element that always shows a classic scrollbar */
  private _probe = document.createElement('div');
  /** the cards this page shows open; a card keeps its state while another opens (DQ-28) */
  private _openCards = new Set(storedCards().map(id => `w:${id}`));
  /** the first workspace list has dropped the stored cards it does not hold */
  private _pruned = false;
  /** the selected row: its list and its key */
  private _selected: string | null = null;
  /** the keys of the tabs that keep the selected row lit while one of them is current (DQ-32) */
  private _selectedTabs: string[] = [];
  /** a mouse press that began in the panel has not ended */
  private _pressed = false;
  private _scrollTo: string | null = null;
  private _query = '';
  private _filterShown = false;
  private _showHidden = false;
  private _closedInFilter = new Set<string>();
}

/** A 24px header button: a tooltip and an aria-label name its action. */
function button(icon: LabIcon, label: string, onClick: () => void): Widget {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'jp-WorkspaceManager-headerButton';
  node.title = label;
  node.setAttribute('aria-label', label);
  icon.element({ container: node });
  node.addEventListener('click', onClick);
  return new Widget({ node });
}

function pressed(widget: Widget, on: boolean): void {
  widget.node.classList.toggle('jp-mod-active', on);
  widget.node.setAttribute('aria-pressed', String(on));
}

/**
 * Make sure closing this tab cannot stop its terminal or kernel, whatever the lab's settings say.
 * shortcut: a Cancel on the unsaved-changes question leaves the guard on the tab, so its later close
 * keeps the kernel too; upgrade if the document manager ever reports the answer.
 */
function keepRunning(widget: Widget): void {
  const w = widget as any;
  if (w.content?.hasClass?.('jp-Terminal')) {
    w.content.setOption('shutdownOnClose', false);
  }
  if (w.sessionContext) {
    w.sessionContext.kernelPreference = {
      ...w.sessionContext.kernelPreference,
      shutdownOnDispose: false
    };
  }
}

/**
 * A button inside a card header: its click, Enter and Space never reach the header; the arrow keys
 * do, so they move the focus between rows. `expanded` makes it the triangle, `pressed` a toggle.
 */
function iconButton(
  icon: LabIcon,
  label: string,
  onClick: (e: React.MouseEvent) => void,
  disabled = false,
  expanded?: boolean,
  pressed?: boolean,
  pointerFocus = false
): React.ReactElement {
  return (
    <button
      className={`jp-WorkspaceManager-iconButton${expanded === undefined ? '' : ' jp-WorkspaceManager-caret'}${pressed ? ' jp-mod-active' : ''}`}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      aria-pressed={pressed}
      disabled={disabled}
      // a click leaves the focus where it was, so a row's shutdown button hides when the pointer leaves;
      // a button that opens a dialog keeps the native pointer focus, so the dialog's default button gets no rim (DQ-19)
      onMouseDown={pointerFocus ? undefined : e => e.preventDefault()}
      onClick={e => {
        e.stopPropagation();
        onClick(e);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
        }
      }}
    >
      <icon.react tag="span" />
    </button>
  );
}

/** The items of a section of another extension, in the view the replaced panel shows by default. */
function running(
  m?: IRunningSessions.IManager
): IRunningSessions.IRunningItem[] {
  return m?.running({ mode: m.supportsMultipleViews ? 'tree' : 'list' }) ?? [];
}

/**
 * The body of the shutdown question: "Workspace B also holds this kernel.",
 * "Workspaces A, B and C also hold this kernel."; without "also" when `names`
 * is longer than `others`: the list then names the workspace the row acts in.
 */
function holdersSentence(
  names: string[],
  others: string[],
  item: string
): string {
  const also = names.length > others.length ? '' : ' also';
  if (names.length === 1) {
    return `Workspace ${names[0]}${also} holds this ${item}.`;
  }
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Workspaces ${list}${also} hold this ${item}.`;
}

/**
 * The tooltip of a row of another extension's section: a language server's id
 * and language, which the LSP extension gives only as the label `id (language)`.
 */
function languageServerTitle(item: IRunningSessions.IRunningItem): string {
  const label = item.label();
  const text = typeof label === 'string' ? label : '';
  // shortcut: the LSP item exposes no id or language; upgrade if it gains detail()
  const match = /^(.*) \(([^()]*)\)$/.exec(text);
  return match ? lines(match[1], match[2]) : text;
}

/** The triangle of a card: a button of its own that opens or closes the card. */
function caret(open: boolean, toggle: () => void): React.ReactElement {
  return iconButton(
    open ? caretDownIcon : caretRightIcon,
    open ? 'Collapse' : 'Expand',
    toggle,
    false,
    open
  );
}

/**
 * A tooltip field of `label` and `value`; a file name can hold a newline, and a
 * tooltip field takes one line. The value stays out of the format string:
 * Gettext reduces a %% in it.
 */
function field(label: string, value?: string | null): string | undefined {
  return value ? `${label}: ${value.replace(/[\r\n]+/g, ' ')}` : undefined;
}

/** A TERMINALS row's label for a numbered terminal: its number in a small box (ACC-TERM-285-NUMBER-BADGE, ACC-TERM-290-BADGE-TINT). */
function terminalBadge(
  name: string,
  colour?: Colour | null
): React.ReactElement {
  return (
    <svg
      className={`jp-WorkspaceManager-terminalBadge${colour ? ` jp-mod-${colour} jp-mod-coloured` : ''}`}
      viewBox="0 0 20 15"
      role="img"
      aria-label={name}
    >
      <rect
        x="1"
        y="1"
        width="18"
        height="13"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <text
        x="10"
        y="11"
        textAnchor="middle"
        fontSize="9.5"
        fill="currentColor"
      >
        {name}
      </text>
    </svg>
  );
}

/** The lists of rows, each one tab stop: an open card's body, an open section's body. */
const LIST = '.jp-WorkspaceManager-cardBody, .jp-WorkspaceManager-sectionBody';

/** The rows of one list; the WORKSPACES body has none, its rows are its cards'. */
function rowsOf(list: Element): HTMLElement[] {
  return Array.from(
    list.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row')
  ).filter(r => r.closest(LIST) === list);
}

/** Move the keyboard focus to the row before or after this one in its list. */
function moveFocus(from: HTMLElement, step: number): void {
  const list = from.closest(LIST);
  const rows = list ? rowsOf(list) : [];
  rows[rows.indexOf(from) + step]?.focus();
}

/** The classes of a detail part: an identifier in the code font (DQ-18), a part that gives way first, a folder of a path cut at its start. */
const CODE = 'jp-WorkspaceManager-code';
const SHRINK = 'jp-mod-shrink';
const TYPE = `${SHRINK} jp-WorkspaceManager-type`;
const FOLDER = `${CODE} ${SHRINK} jp-WorkspaceManager-folder`;

/** What a row's icon handle drags: a path list under PATH_MIME, or raw text under TEXT_MIME. */
interface IRowDrag {
  mime: string;
  data: string | string[];
}

/**
 * Start a Lumino drag when a press on a row's icon handle moves past the
 * threshold, so a still press stays the row's click (ACC-DRAG-319-FILE-PATH).
 */
function dragFrom(event: React.MouseEvent<HTMLElement>, drag: IRowDrag): void {
  if (event.button !== 0) {
    return;
  }
  // the handle carries an icon; no text selection starts on it
  event.preventDefault();
  const handle = event.currentTarget;
  const pressX = event.clientX;
  const pressY = event.clientY;
  const gesture = new AbortController();
  const stop = (): void => gesture.abort();
  const onMove = (move: MouseEvent): void => {
    if (
      Math.abs(move.clientX - pressX) < DRAG_THRESHOLD &&
      Math.abs(move.clientY - pressY) < DRAG_THRESHOLD
    ) {
      return;
    }
    stop();
    const mimeData = new MimeData();
    mimeData.setData(drag.mime, drag.data);
    const lumino = new Drag({
      mimeData,
      dragImage: handle.cloneNode(true) as HTMLElement,
      supportedActions: 'copy',
      proposedAction: 'copy',
      source: handle
    });
    // a drag disposes itself when it ends
    void lumino.start(move.clientX, move.clientY).then(() => lumino.dispose());
  };
  document.addEventListener('mousemove', onMove, {
    capture: true,
    signal: gesture.signal
  });
  document.addEventListener('mouseup', stop, {
    capture: true,
    signal: gesture.signal
  });
}

/**
 * A row: its type icon, its name, a terminal's tab name or process (DQ-24, DQ-31) and path (DQ-30), a kernel's state
 * dot and word, its time; selected, the lines of its details under them (DQ-17). Its focus, by a
 * click or the arrow keys, selects it.
 */
function row(props: {
  key: string;
  /** the panel's one selected row */
  selected: boolean;
  /** the row of the shell's current widget: a pale tint under hover and selection (ACC-LISTS-273-CURRENT-ROW) */
  current?: boolean;
  select: () => void;
  icon: LabIcon | React.ReactElement;
  /** what the row's icon handle drags; no handle when absent */
  drag?: IRowDrag;
  label: React.ReactNode;
  /** the label is an identifier: the code font */
  code?: boolean;
  /** a terminal's tab name, else its process (DQ-31): it stands in the line, selected or not (DQ-24) */
  process?: string | null;
  /** the working directory of the foreground process: it stands after the process, in the free width (DQ-30) */
  path?: string | null;
  /** a kernel's memory: it stands in the line, selected or not (ACC-KERNEL-281-ROW-MEMORY) */
  memory?: string;
  /** a kernel's state: its word stands in the line, the title and the dot's aria-label (DQ-13) */
  state?: { word: string; dot: string };
  /** the time since the last activity, and its recent or stale emphasis (DQ-09) */
  when?: IAge;
  /** the detail lines while selected: each part's text and classes; an empty part, and a line of none, is left out */
  detail?: [string, string][][];
  title: string;
  /** a child row of an item of another extension's section: indented */
  child?: boolean;
  /** the shutdown button of an item of another extension's section */
  shutdown?: { label: string; icon: LabIcon; execute: () => void };
  open: () => void;
  menu?: IRowAction[];
}): React.ReactElement {
  const { drag, icon, menu, shutdown, state, when } = props;
  const iconElement =
    icon instanceof LabIcon ? (
      <icon.react tag="span" className="jp-WorkspaceManager-rowIcon" />
    ) : (
      icon
    );
  const detail = props.selected
    ? (props.detail ?? [])
        .map(line => line.filter(([text]) => text))
        .filter(line => line.length)
    : [];
  const classes = [
    'jp-WorkspaceManager-row',
    props.child ? 'jp-mod-child' : '',
    props.selected ? 'jp-mod-selected' : '',
    props.current ? 'jp-mod-current' : '',
    when?.mod ?? ''
  ];
  return (
    <div
      key={props.key}
      className={classes.filter(Boolean).join(' ')}
      aria-current={props.current ? 'true' : undefined}
      data-row-key={props.key}
      // the list's tab stop is set on the DOM (_render), where React never resets it
      tabIndex={-1}
      title={props.title}
      onFocus={e => {
        const list = e.currentTarget.closest(LIST);
        for (const r of list ? rowsOf(list) : []) {
          r.tabIndex = r === e.currentTarget ? 0 : -1;
        }
        props.select();
      }}
      onClick={props.open}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          props.open();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          moveFocus(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
        }
      }}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        if (menu) {
          const rect = e.currentTarget.getBoundingClientRect();
          // the context-menu key gives no pointer position
          actionMenu(menu).open(
            e.clientX || rect.left,
            e.clientY || rect.bottom
          );
        }
      }}
    >
      {drag ? (
        // the icon alone is the handle, so dragging never takes the row's text selection (ACC-DRAG-319-FILE-PATH)
        <span
          className="jp-WorkspaceManager-rowDrag"
          onMouseDown={e => dragFrom(e, drag)}
        >
          {iconElement}
        </span>
      ) : (
        iconElement
      )}
      {/* an empty label renders no span, which would take a second column gap after the icon (ACC-TERM-302-ICON-GAP) */}
      {props.label !== '' && (
        <span
          className={`jp-WorkspaceManager-rowLabel${props.code ? ` ${CODE}` : ''}`}
        >
          {props.label}
        </span>
      )}
      {props.process && (
        <span className="jp-WorkspaceManager-rowProcess">{props.process}</span>
      )}
      {props.process && props.path && (
        <span className="jp-WorkspaceManager-rowPathSlot">
          <span className="jp-WorkspaceManager-rowPath">
            <bdi>{props.path}</bdi>
          </span>
        </span>
      )}
      {props.memory && (
        <span className="jp-WorkspaceManager-rowMemory">{props.memory}</span>
      )}
      {state && (
        <span className="jp-WorkspaceManager-state" title={state.word}>
          <span className={state.dot} role="img" aria-label={state.word} />
          {state.word}
        </span>
      )}
      {when && <span className="jp-WorkspaceManager-age">{when.label}</span>}
      {shutdown && iconButton(shutdown.icon, shutdown.label, shutdown.execute)}
      {detail.map((line, i) => (
        <span key={`detail-${i}`} className="jp-WorkspaceManager-rowDetail">
          {line.map(([text, classes], j) => (
            <span key={j} className={classes || undefined}>
              {text}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
