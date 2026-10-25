import type { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import type {
  IRunningSessionManagers,
  IRunningSessions,
  IRunningSessionSidebar
} from '@jupyterlab/running';
import type { ISectionEntry } from '@jupyterlab/apputils';
import {
  addIcon,
  caretDownIcon,
  caretRightIcon,
  closeIcon,
  ellipsesIcon,
  fileIcon,
  filterIcon,
  kernelIcon,
  LabIcon,
  refreshIcon,
  SidePanel,
  tabIcon,
  Toolbar
} from '@jupyterlab/ui-components';
import type { Message } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import type { Menu } from '@lumino/widgets';
import { Panel, Widget } from '@lumino/widgets';
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { elsewhere, type ILoaded, load, patchMeta, workspaces } from '../api';
import {
  closeTabsIcon,
  eyeIcon,
  eyeOffIcon,
  openIcon,
  terminalGlyph
} from '../icons';
import { age } from '../model/age';
import { filterSections, type ICard } from '../model/filter';
import {
  buildModel,
  type IKernelRow,
  type IModel,
  type IRecord,
  type ISection,
  type ITab,
  type ITabRow,
  type ITerminalRow,
  lines,
  tabsOf,
  withoutTabs
} from '../model/model';
import { newRecord } from '../model/new';
import { assignColours, type Colour, nextColour } from '../model/palette';
import { confirm, descriptionDialog, newWorkspaceDialog } from './dialogs';
import { actionMenu, workspaceMenu } from './menus';

/** The section of the panel that lists the running language servers. */
const LANGUAGE_SERVERS = 'Language servers';
const POLL_MS = 10000;
const SPIN_MS = 500;
/** The lists before the first reload: a list that fails at once stays empty. */
const EMPTY: ILoaded = {
  workspaces: [],
  records: {},
  last: null,
  terminals: [],
  kernels: [],
  sessions: []
};

const keyOf = (section: ISection) => `w:${section.id}`;
const dirname = (path = '') =>
  path.slice(0, Math.max(0, path.lastIndexOf('/')));

export namespace WorkspacePanel {
  export interface IOptions {
    /** the shell, the commands and the service manager of the lab */
    app: JupyterFrontEnd;
    /** this window's workspace id */
    current: string;
    /** the id of this browser window for presence */
    window: string;
    managers?: IRunningSessionManagers | null;
  }
}

/**
 * The workspace panel in the sidebar place of the Running panel: a toolbar
 * header (title and buttons; other extensions add theirs after them), the
 * filter field, then four accordion sections - WORKSPACES holding one card per
 * workspace, then KERNELS, TERMINALS and LANGUAGE SERVERS with what belongs to
 * no workspace. One section is open at a time. The cards are React, rendered
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
    this._current = options.current;
    this._window = options.window;
    this._managers = options.managers ?? null;
    this.addClass('jp-WorkspaceManager');
    this.content.addClass('jp-WorkspaceManager-content');
    this.toolbar.addClass('jp-WorkspaceManager-header');

    const title = new Widget();
    title.addClass('jp-WorkspaceManager-title');
    const label = document.createElement('span');
    label.className = 'jp-WorkspaceManager-titleLabel';
    label.textContent = 'WORKBENCH';
    title.node.appendChild(label);
    this.toolbar.addItem('title', title);
    this.toolbar.addItem('spacer', Toolbar.createSpacerItem());
    this.toolbar.addItem(
      'new',
      button(addIcon, 'New workspace', () => void this.newWorkspace())
    );
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

    this._root = createRoot(this.content.node);
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
    this._stopPolling();
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
      const form = await newWorkspaceDialog((await store.list()).ids);
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
      await store.save(form.name, { data: {}, metadata: { id: form.name } });
      this._open = this._scrollTo = `w:${form.name}`;
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

  /** One reload at a time; a failed list keeps its last content under one line. */
  private _reload(): Promise<void> {
    if (!this._loading) {
      const changes = this._changes;
      this._loading = load(this._settings)
        .then(({ failed, ...data }) => {
          // an action that ended during this load is newer than its data
          if (changes !== this._changes) {
            return;
          }
          this._data = { ...(this._data ?? EMPTY), ...data };
          this._last = data.last ?? this._last;
          this._error = failed.length
            ? `Reload failed: ${failed.join(', ')}`
            : '';
          this._giveColours();
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

  /** A workspace without a stored colour takes the next one of the rotation. */
  private _giveColours(): void {
    const ids = (this._model()?.sections ?? [])
      .filter(s => !s.colour)
      .map(s => s.id)
      .reverse();
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

  private _model(data = this._data): IModel | null {
    if (!data) {
      return null;
    }
    const model = buildModel({
      ...data,
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

  /** The open tabs of this window, keyed as the layout restorer keys them. */
  private _liveTabs(): ITab[] {
    this._live.clear();
    const tabs: ITab[] = [];
    for (const area of ['main', 'down']) {
      for (const widget of this._app.shell.widgets(area)) {
        const w = widget as any;
        const path: string | undefined =
          w.context?.path ?? w.sessionContext?.path;
        const terminal = w.content?.hasClass?.('jp-Terminal')
          ? w.content.session?.name
          : undefined;
        const console = widget.hasClass('jp-ConsolePanel');
        const key = terminal
          ? `terminal:${terminal}`
          : widget.hasClass('jp-NotebookPanel')
            ? `notebook:${path}`
            : console
              ? `console:${path}`
              : path
                ? `document:${path}`
                : `widget:${widget.id}`;
        this._live.set(key, [...(this._live.get(key) ?? []), widget]);
        tabs.push({
          key,
          path,
          title: widget.title.label,
          name: console ? widget.title.label : undefined
        });
      }
    }
    return tabs;
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
    // the filter shows the workspace cards: its section opens as the query starts
    if (query.trim()) {
      this._section = 'workspaces';
    }
    this._render();
  }

  /** A section header: it opens and closes the open one; a second click closes it. */
  private _toggleSection(key: string): void {
    this._section = this._section === key ? null : key;
    this._render();
  }

  private _isOpen(key: string): boolean {
    return this._query.trim()
      ? !this._closedInFilter.has(key)
      : this._open === key;
  }

  /** The triangle, or a header that does not switch: one card open outside a filter; inside it, this card only. */
  private _toggle(key: string): void {
    if (this._query.trim()) {
      if (!this._closedInFilter.delete(key)) {
        this._closedInFilter.add(key);
      }
    } else {
      this._open = this._open === key ? null : key;
    }
    this._render();
  }

  private _render(): void {
    if (this.isDisposed) {
      return;
    }
    const model = this._model();
    const sections = model?.sections ?? [];
    const filtering = !!this._query.trim();
    const { cards, unmatched } = filterSections(
      sections,
      this._query,
      this._showHidden
    );
    const unowned = model?.unowned ?? { terminals: [], kernels: [] };
    const servers = running(this._languageServers());
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
          <div className="jp-WorkspaceManager-list">
            {this._renderSection(
              'workspaces',
              'WORKSPACES',
              cards.length,
              <>
                {cards.map(card => this._renderCard(card, filtering, now))}
                {model && !filtering && !cards.length && (
                  <div className="jp-WorkspaceManager-empty">No workspaces</div>
                )}
                {filtering && !cards.length && (
                  <div className="jp-WorkspaceManager-note">
                    Nothing matches
                  </div>
                )}
                {filtering && cards.length > 0 && unmatched > 0 && (
                  <div className="jp-WorkspaceManager-note">
                    {unmatched} {unmatched === 1 ? 'workspace' : 'workspaces'}{' '}
                    without a match {unmatched === 1 ? 'is' : 'are'} not shown
                  </div>
                )}
                {hidden > 0 && (
                  <div className="jp-WorkspaceManager-note">
                    <eyeOffIcon.react
                      tag="span"
                      className="jp-WorkspaceManager-noteIcon"
                    />
                    {hidden} hidden {hidden === 1 ? 'workspace' : 'workspaces'}
                  </div>
                )}
              </>
            )}
            {unowned.kernels.length > 0 &&
              this._renderSection(
                'kernels',
                'KERNELS',
                unowned.kernels.length,
                unowned.kernels.map(k => this._kernelRow(null, k, now)),
                'kernels'
              )}
            {unowned.terminals.length > 0 &&
              this._renderSection(
                'terminals',
                'TERMINALS',
                unowned.terminals.length,
                unowned.terminals.map(t => this._terminalRow(null, t, now)),
                'terminals'
              )}
            {servers.length > 0 &&
              this._renderSection(
                'servers',
                'LANGUAGE SERVERS',
                servers.length,
                this._managerRows(this._languageServers()!),
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
    if (target) {
      target.scrollIntoView?.({ block: 'nearest' });
      this._scrollTo = null;
    }
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
          aria-label="Filter workspaces, tabs, terminals and kernels"
          placeholder="Filter"
          spellCheck={false}
          value={this._query}
          onChange={e => this._setQuery(e.target.value)}
        />
        {this._query && (
          <button
            className="jp-WorkspaceManager-iconButton"
            title="Clear filter"
            aria-label="Clear filter"
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
   * One accordion section: the header carries the label, the count and, for the
   * sections below WORKSPACES, a Shut down all; only the open section shows its body.
   */
  private _renderSection(
    key: string,
    label: string,
    n: number,
    body: React.ReactNode,
    shutdown?: 'servers' | 'terminals' | 'kernels'
  ): React.ReactElement {
    const open = this._section === key;
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
          aria-expanded={open}
          onClick={() => this._toggleSection(key)}
          onKeyDown={e => {
            if (
              e.target === e.currentTarget &&
              (e.key === 'Enter' || e.key === ' ')
            ) {
              e.preventDefault();
              this._toggleSection(key);
            }
          }}
        >
          {caret(open, () => this._toggleSection(key))}
          <span className="jp-WorkspaceManager-sectionLabel">{label}</span>
          <span className="jp-WorkspaceManager-sectionCount">({n})</span>
          {shutdown && (
            <button
              className="jp-WorkspaceManager-button"
              onClick={e => {
                e.stopPropagation();
                void this._shutDownSection(shutdown);
              }}
            >
              Shut down all
            </button>
          )}
        </div>
        {open && <div className="jp-WorkspaceManager-sectionBody">{body}</div>}
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
      section.current ? 'jp-mod-current' : '',
      // not jp-mod-hidden: JupyterLab sets display: none on that class
      section.hidden ? 'jp-mod-hiddenWorkspace' : '',
      open ? 'jp-mod-open' : ''
    ];
    const when = age(section.lastModified, now);
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
          className="jp-WorkspaceManager-cardHeader"
          role="button"
          tabIndex={0}
          aria-expanded={switches ? undefined : open}
          title={section.purpose ? `${name}\n${section.purpose}` : name}
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
        >
          <div className="jp-WorkspaceManager-headerLine">
            {caret(open, () => this._toggle(key))}
            <span className="jp-WorkspaceManager-name">{name}</span>
            {!open && !section.hidden && (
              <span className="jp-WorkspaceManager-hoverActions">
                {iconButton(
                  openIcon,
                  'Open workspace',
                  () => void this._openWorkspace(section),
                  section.current
                )}
                {iconButton(
                  closeTabsIcon,
                  'Close all tabs',
                  () => void this._closeAll(section)
                )}
              </span>
            )}
            {section.hidden ? (
              <>
                <span className="jp-WorkspaceManager-hiddenWord">hidden</span>
                {iconButton(
                  eyeOffIcon,
                  'Show workspace again',
                  () => void this._store(id, { hidden: false })
                )}
              </>
            ) : (
              <span className={when.className}>
                {when.dot && (
                  <span className="jp-WorkspaceManager-dot jp-mod-busy" />
                )}
                {when.label}
              </span>
            )}
            {!section.hidden &&
              iconButton(ellipsesIcon, 'Workspace menu', e =>
                this._openMenu(section, e.currentTarget as HTMLElement)
              )}
          </div>
          {!section.hidden && (
            <div className="jp-WorkspaceManager-headerLine">
              <span className="jp-WorkspaceManager-purpose">
                {section.purpose}
              </span>
              {filtering ? (
                <span className="jp-WorkspaceManager-counts">
                  ({card.shown} of {card.total})
                </span>
              ) : (
                <span className="jp-WorkspaceManager-counts">
                  {count(tabIcon, 'Tabs', section.tabs.length)}
                  {count(terminalGlyph, 'Terminals', section.terminals.length)}
                  {count(kernelIcon, 'Kernels', section.kernels.length)}
                </span>
              )}
            </div>
          )}
        </div>
        {open && (
          <div className="jp-WorkspaceManager-cardBody">
            {card.tabs.length > 0 &&
              this._group(
                'TABS',
                card.tabs.length,
                card.tabs.map(t => this._tabRow(section, t))
              )}
            {card.terminals.length > 0 &&
              this._group(
                'TERMINALS',
                card.terminals.length,
                card.terminals.map(t => this._terminalRow(section, t, now))
              )}
            {card.kernels.length > 0 &&
              this._group(
                'KERNELS',
                card.kernels.length,
                card.kernels.map(k => this._kernelRow(section, k, now))
              )}
            {card.total === 0 && (
              <div className="jp-WorkspaceManager-empty">
                No tabs, terminals or kernels
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  private _group(
    label: string,
    n: number,
    rows: React.ReactElement[]
  ): React.ReactElement {
    return (
      <div className="jp-WorkspaceManager-group" key={label}>
        <div className="jp-WorkspaceManager-groupLabel">
          {label} <span>({n})</span>
        </div>
        {rows}
      </div>
    );
  }

  private _tabRow(section: ISection, tab: ITabRow): React.ReactElement {
    const live = section.current ? this._live.get(tab.key)?.[0] : undefined;
    const icon = tab.path
      ? (this._app.docRegistry.getFileTypesForPath(tab.path)[0]?.icon ??
        fileIcon)
      : live?.title.icon instanceof LabIcon
        ? live.title.icon
        : fileIcon;
    return row({
      key: tab.key,
      icon,
      label: tab.label,
      detail: dirname(tab.path),
      folder: true,
      title: tab.path ?? '',
      open: () => this._openRow(section, tab.key),
      menu: [
        {
          label: 'Close tab',
          icon: closeIcon,
          execute: () => void this._closeTab(section, tab.key)
        }
      ]
    });
  }

  private _terminalRow(
    /** null for a row of the TERMINALS section: a terminal in no workspace */
    section: ISection | null,
    t: ITerminalRow,
    now: number
  ): React.ReactElement {
    const when = age(t.lastActivity, now);
    return row({
      key: `terminal:${t.name}`,
      icon: terminalGlyph,
      label: t.process ?? `terminal ${t.name}`,
      detail: t.process ? `terminal ${t.name}` : '',
      also: t.alsoIn,
      title: lines(`terminal ${t.name}`, t.process, when.label),
      age: (
        <span className={when.className}>
          {when.dot && <span className="jp-WorkspaceManager-dot jp-mod-busy" />}
          {when.label}
        </span>
      ),
      open: () =>
        section === null
          ? void this._app.commands.execute('terminal:open', { name: t.name })
          : this._openRow(section, `terminal:${t.name}`),
      menu: [
        {
          label: 'Shut down terminal',
          icon: closeIcon,
          execute: () => void this._shutDownTerminal(t)
        }
      ]
    });
  }

  private _kernelRow(
    /** null for a row of the KERNELS section: a kernel in no workspace */
    section: ISection | null,
    k: IKernelRow,
    now: number
  ): React.ReactElement {
    return row({
      key: `kernel:${k.id}`,
      icon: kernelIcon,
      label: k.label,
      detail: k.detail,
      also: k.alsoIn,
      title: k.title,
      age: (
        <span className={age(k.lastActivity, now).className}>
          <span className={k.dotClass} />
          {age(k.lastActivity, now).label}
        </span>
      ),
      open: () => {
        if (section !== null) {
          this._openRow(section, `notebook:${k.path}`, `console:${k.path}`);
          return;
        }
        const session = this._data?.sessions.find(s => s.kernel?.id === k.id);
        if (session?.type === 'notebook' && k.path) {
          void this._app.commands.execute('docmanager:open', { path: k.path });
        }
      },
      menu: [
        {
          label: 'Shut down kernel',
          icon: closeIcon,
          execute: () =>
            void this._act(() =>
              this._app.serviceManager.kernels.shutdown(k.id)
            )
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
              detail: item.detail?.() ?? '',
              title: languageServerTitle(item),
              child,
              shutdown: item.shutdown && {
                label: label ?? 'Shut Down',
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
    const n = this._model()?.unowned[kind].length ?? 0;
    const word = kind === 'terminals' ? 'terminal' : 'kernel';
    if (
      !(await confirm(
        'Shut down all?',
        `Shut down ${n} ${word}${n === 1 ? '' : 's'} in no workspace.`,
        'Shut down all'
      ))
    ) {
      return;
    }
    await this._act(async () => {
      // what is in no workspace now: another window may have moved a row while the dialog was open
      const { failed, ...data } = await load(this._settings);
      if (failed.length) {
        throw new Error(
          `Nothing was shut down. Reload failed: ${failed.join(', ')}`
        );
      }
      const unowned = this._model({ ...EMPTY, ...data })!.unowned;
      if (kind === 'terminals') {
        await Promise.all(
          unowned.terminals.map(x =>
            this._app.serviceManager.terminals.shutdown(x.name)
          )
        );
      } else {
        await Promise.all(
          unowned.kernels.map(x =>
            this._app.serviceManager.kernels.shutdown(x.id)
          )
        );
      }
    });
  }

  private _openMenu(section: ISection, anchor: HTMLElement): void {
    const id = section.id;
    const menu: Menu = workspaceMenu(section.colour, section.current, {
      open: () => void this._openWorkspace(section),
      openInNewTab: () => void this._openWorkspace(section, true),
      closeAll: () => void this._closeAll(section),
      describe: () => void this._describe(section),
      colour: colour => void this._store(id, { colour }),
      hide: () => void this._store(id, { hidden: true }),
      delete: () => void this._delete(section)
    });
    const rect = anchor.getBoundingClientRect();
    menu.open(rect.left, rect.bottom);
  }

  /** Refuse an action on a workspace that another browser window shows. */
  private async _refused(id: string, action: string): Promise<boolean> {
    if (!(await elsewhere(this._settings, this._window)).includes(id)) {
      return false;
    }
    void showErrorMessage(
      'Workspace open in another window',
      `${action} is refused: workspace ${id} is open in another browser window. Close it there first.`
    );
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
    const widget = keys.map(k => this._live.get(k)?.[0]).find(Boolean);
    if (widget) {
      this._app.shell.activateById(widget.id);
    }
  }

  private async _closeAll(section: ISection): Promise<void> {
    const id = section.id;
    await this._act(async () => {
      if (!section.current && (await this._refused(id, 'Close all tabs'))) {
        return;
      }
      const n = section.terminals.length;
      if (
        n > 0 &&
        !(await confirm(
          `Close all tabs of ${id}?`,
          `The workspace holds ${n} ${n === 1 ? 'terminal' : 'terminals'}. ` +
            'They keep running without a tab, and the culler may then shut them down after its idle time.',
          'Close all tabs'
        ))
      ) {
        return;
      }
      if (section.current) {
        await this._app.commands.execute('application:close-all');
      } else {
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

  private async _closeTab(section: ISection, key: string): Promise<void> {
    if (section.current) {
      // one view at a time: each closes as JupyterLab's own close does, so the
      // last view of an unsaved document asks; a view still open after its
      // close is asking, and the rest wait for the user
      for (const view of this._live.get(key) ?? []) {
        view.close();
        await new Promise(resolve => setTimeout(resolve));
        if (view.isAttached) {
          return;
        }
      }
      return;
    }
    const id = section.id;
    await this._act(async () => {
      if (await this._refused(id, 'Close tab')) {
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

  private async _delete(section: ISection): Promise<void> {
    const id = section.id;
    await this._act(async () => {
      if (section.current || (await this._refused(id, 'Delete workspace'))) {
        return;
      }
      await workspaces(this._settings).remove(id);
      if (this._open === `w:${id}`) {
        this._open = null;
      }
    });
  }

  private async _describe(section: ISection): Promise<void> {
    const purpose = await descriptionDialog(section.id, section.purpose);
    if (purpose !== null) {
      await this._store(section.id, { purpose: purpose.trim() });
    }
  }

  private async _shutDownTerminal(t: ITerminalRow): Promise<void> {
    if (
      t.alsoIn.length &&
      !(await confirm(
        `Shut down terminal ${t.name}?`,
        `Workspace ${t.alsoIn.join(', ')} also holds this terminal.`,
        'Shut down'
      ))
    ) {
      return;
    }
    await this._act(() => this._app.serviceManager.terminals.shutdown(t.name));
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
  private _current: string;
  private _window: string;
  private _managers: IRunningSessionManagers | null;
  private _root: Root;
  private _filterButton: Widget;
  private _hiddenButton: Widget;
  private _refreshButton: Widget;
  private _sectionAdded = new Signal<this, ISectionEntry>(this);

  private _data: ILoaded | null = null;
  private _error = '';
  private _loading: Promise<void> | null = null;
  /** user actions ended so far; a load started before the last one is discarded */
  private _changes = 0;
  private _timer = 0;
  private _tabsTimer = 0;
  /** the views of each open tab key; two views of one document share a key */
  private _live = new Map<string, Widget[]>();
  /** colours this page gave to workspaces whose record has none */
  private _colours: { [id: string]: Colour } = {};
  /** the colour given last, as the server keeps it for every window */
  private _last: Colour | null = null;

  /** the open section of the accordion: one at a time, WORKSPACES first */
  private _section: string | null = 'workspaces';
  private _open: string | null = null;
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

/** A button inside a card header: its click and keys never reach the header; `expanded` makes it the triangle. */
function iconButton(
  icon: LabIcon,
  label: string,
  onClick: (e: React.MouseEvent) => void,
  disabled = false,
  expanded?: boolean
): React.ReactElement {
  return (
    <button
      className={`jp-WorkspaceManager-iconButton${expanded === undefined ? '' : ' jp-WorkspaceManager-caret'}`}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      disabled={disabled}
      // a click leaves the focus where it was, so it leaves no hover icons shown
      onMouseDown={e => e.preventDefault()}
      onClick={e => {
        e.stopPropagation();
        onClick(e);
      }}
      onKeyDown={e => e.stopPropagation()}
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

function count(icon: LabIcon, label: string, n: number): React.ReactElement {
  return (
    <span className="jp-WorkspaceManager-count" title={label} key={label}>
      <icon.react tag="span" />
      {n}
    </span>
  );
}

/** Move the keyboard focus to the row before or after this one in its card. */
function moveFocus(from: HTMLElement, step: number): void {
  const rows = Array.from(
    from
      .closest('.jp-WorkspaceManager-cardBody')
      ?.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row') ?? []
  );
  rows[rows.indexOf(from) + step]?.focus();
}

function row(props: {
  key: string;
  icon: LabIcon | React.ReactElement;
  label: React.ReactNode;
  detail: string;
  /** the detail is a folder: it shortens before the label does */
  folder?: boolean;
  title: string;
  also?: string[];
  age?: React.ReactElement;
  /** a child row of an item of another extension's section: indented */
  child?: boolean;
  /** the shutdown button of an item of another extension's section */
  shutdown?: { label: string; icon: LabIcon; execute: () => void };
  open: () => void;
  menu?: { label: string; icon: LabIcon; execute: () => void }[];
}): React.ReactElement {
  const { icon, menu, shutdown } = props;
  return (
    <div
      key={props.key}
      className={`jp-WorkspaceManager-row${props.child ? ' jp-mod-child' : ''}`}
      tabIndex={0}
      title={props.title}
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
      {icon instanceof LabIcon ? (
        <icon.react tag="span" className="jp-WorkspaceManager-rowIcon" />
      ) : (
        icon
      )}
      <span className="jp-WorkspaceManager-rowLabel">{props.label}</span>
      {props.detail && (
        <span
          className={`jp-WorkspaceManager-rowDetail${props.folder ? ' jp-WorkspaceManager-rowFolder' : ''}`}
        >
          {props.detail}
        </span>
      )}
      {props.also?.length ? (
        <span className="jp-WorkspaceManager-rowDetail jp-WorkspaceManager-rowAlso">
          also in{' '}
          <span className="jp-WorkspaceManager-rowAlsoName">
            {props.also.join(', ')}
          </span>
        </span>
      ) : null}
      {props.age}
      {shutdown && iconButton(shutdown.icon, shutdown.label, shutdown.execute)}
    </div>
  );
}
