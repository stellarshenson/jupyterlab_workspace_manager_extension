import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import type { MainAreaWidget } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import {
  IRunningSessionManagers,
  IRunningSessionSidebar
} from '@jupyterlab/running';
import { IStateDB } from '@jupyterlab/statedb';
import { ITerminalTracker, type ITerminal } from '@jupyterlab/terminal';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { UUID } from '@lumino/coreutils';
import type { Drag } from '@lumino/dragdrop';

import { report } from './api';
import { panelIcon } from './icons';
import { pagePlugin } from './page';
// eslint-disable-next-line jupyter/prefer-lazy-imports -- activate builds the sidebar synchronously, so the panel class cannot wait for a later import
import { TEXT_MIME, WorkspacePanel } from './panel/panel';

const PRESENCE_MS = 30000;
const WINDOW_PREFIX = 'jupyterlab-workspace-manager:';

/**
 * The id of this browser tab for presence. `window.name` survives a reload
 * and a navigation of the tab, and a tab that this one opens starts with an
 * empty name, so the two never share an id.
 */
function windowId(): string {
  if (!window.name.startsWith(WINDOW_PREFIX)) {
    window.name = WINDOW_PREFIX + UUID.uuid4();
  }
  return window.name;
}

/**
 * The workspace panel in the sidebar place of Running Terminals and Kernels;
 * `package.json` disables `@jupyterlab/running-extension:sidebar`, and this
 * plugin provides its token, its id, its restorer name and its command.
 */
const plugin: JupyterFrontEndPlugin<IRunningSessionSidebar> = {
  id: '@stellarshenson/jupyterlab-workspace-manager-extension:plugin',
  description:
    'Workspace-driven Running panel: workspaces as coloured accordion sections with their tabs, terminals and kernels',
  autoStart: true,
  provides: IRunningSessionSidebar,
  requires: [IRunningSessionManagers, IDocumentManager],
  optional: [
    ILayoutRestorer,
    ILabShell,
    ITranslator,
    ITerminalTracker,
    IStateDB
  ],
  activate: (
    app: JupyterFrontEnd,
    managers: IRunningSessionManagers,
    docManager: IDocumentManager,
    restorer: ILayoutRestorer | null,
    labShell: ILabShell | null,
    translator: ITranslator | null,
    terminalTracker: ITerminalTracker | null,
    state: IStateDB | null
  ): IRunningSessionSidebar => {
    const trans = (translator ?? nullTranslator).load(
      '@stellarshenson/jupyterlab-workspace-manager-extension'
    );
    const current = PageConfig.getOption('workspace') || 'default';
    const id = windowId();
    const panel = new WorkspacePanel({
      app,
      docManager,
      current,
      window: id,
      managers,
      restorer,
      state,
      trans
    });
    panel.id = 'jp-running-sessions';
    panel.title.icon = panelIcon;
    panel.title.caption = trans.__('Workspaces, Terminals and Kernels');
    panel.node.setAttribute('role', 'region');
    panel.node.setAttribute('aria-label', trans.__('Workspaces section'));
    if (restorer) {
      restorer.add(panel, 'running-sessions');
    }
    app.shell.add(panel, 'left', { rank: 200, type: 'Sessions and Tabs' });
    labShell?.layoutModified.connect(() => panel.tabsChanged());

    // a row handle dropped on a terminal pastes its text at the caret (ACC-DRAG-323-TEXT-DROP)
    const pasteInto = (widget: MainAreaWidget<ITerminal.ITerminal>): void => {
      // only this panel's raw-text payload is taken: PATH_MIME belongs to the advanced file browser's targets
      const textOf = (event: Drag.Event): string | null => {
        const text = event.mimeData.getData(TEXT_MIME);
        return typeof text === 'string' ? text : null;
      };
      // the terminal node fills the tab, so it receives the drop
      const node = widget.content.node;
      node.addEventListener('lm-dragenter', (event: Event) => {
        if (textOf(event as Drag.Event) === null) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      });
      node.addEventListener('lm-dragover', (event: Event) => {
        const drag = event as Drag.Event;
        if (textOf(drag) === null) {
          return;
        }
        drag.preventDefault();
        drag.stopPropagation();
        drag.dropAction = drag.proposedAction;
      });
      node.addEventListener('lm-drop', (event: Event) => {
        const drag = event as Drag.Event;
        const text = textOf(drag);
        if (text === null) {
          return;
        }
        drag.preventDefault();
        drag.stopPropagation();
        app.shell.activateById(widget.id);
        if (typeof widget.content.paste === 'function') {
          widget.content.paste(text);
        } else {
          widget.content.session.send({ type: 'stdin', content: [text] });
        }
      });
    };
    terminalTracker?.forEach(pasteInto);
    terminalTracker?.widgetAdded.connect((_, widget) => pasteInto(widget));

    app.commands.addCommand('running:show-panel', {
      label: trans.__('Workspaces'),
      describedBy: { args: null },
      execute: () => app.shell.activateById(panel.id)
    });

    // at load and every 30 s, so other windows refuse actions on this workspace
    const settings = app.serviceManager.serverSettings;
    const tell = () => report(settings, id, current).catch(() => undefined);
    void tell();
    setInterval(tell, PRESENCE_MS);
    return panel;
  }
};

export default [plugin, pagePlugin];
