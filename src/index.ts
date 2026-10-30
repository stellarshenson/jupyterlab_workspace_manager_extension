import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { PageConfig } from '@jupyterlab/coreutils';
import {
  IRunningSessionManagers,
  IRunningSessionSidebar
} from '@jupyterlab/running';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { UUID } from '@lumino/coreutils';

import { report } from './api';
import { panelIcon } from './icons';
// eslint-disable-next-line jupyter/prefer-lazy-imports -- activate builds the sidebar synchronously, so the panel class cannot wait for a later import
import { WorkspacePanel } from './panel/panel';

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
  requires: [IRunningSessionManagers],
  optional: [ILayoutRestorer, ILabShell, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    managers: IRunningSessionManagers,
    restorer: ILayoutRestorer | null,
    labShell: ILabShell | null,
    translator: ITranslator | null
  ): IRunningSessionSidebar => {
    const trans = (translator ?? nullTranslator).load(
      '@stellarshenson/jupyterlab-workspace-manager-extension'
    );
    const current = PageConfig.getOption('workspace') || 'default';
    const id = windowId();
    const panel = new WorkspacePanel({
      app,
      current,
      window: id,
      managers,
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

export default plugin;
