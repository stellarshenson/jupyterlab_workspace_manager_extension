import { JupyterFrontEnd } from '@jupyterlab/application';
import { LabIcon } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';

import { pageIcon } from '../icons';
import { pagePlugin } from '../page';

/** A front end with the command registry and the two shell calls the command makes. */
function fakeApp() {
  const shell = {
    added: [] as { widget: any; area: string }[],
    activated: [] as string[],
    add(widget: any, area: string): void {
      this.added.push({ widget, area });
    },
    activateById(id: string): void {
      this.activated.push(id);
    }
  };
  const app = {
    commands: new CommandRegistry(),
    shell
  } as unknown as JupyterFrontEnd;
  pagePlugin.activate(app, null);
  return { app, shell };
}

const URL = '/proxy/47987/workbench-card-mockup.html';

/** The iframe a widget shows. */
function frameOf(widget: any): HTMLIFrameElement {
  return widget.node.querySelector('iframe') as HTMLIFrameElement;
}

describe('workspace-page:open', () => {
  it('ACC-OPEN-287-PAGE-POLICY: without a policy the iframe is sandboxed to allow-scripts and the tab takes the given title with the standard page icon', async () => {
    const { app, shell } = fakeApp();
    expect(app.commands.hasCommand('workspace-page:open')).toBe(true);

    const widget = await app.commands.execute('workspace-page:open', {
      url: URL,
      title: 'Workbench page'
    });
    const frame = frameOf(widget);

    expect(frame.getAttribute('src')).toBe(URL);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(widget.title.label).toBe('Workbench page');
    expect(widget.title.icon).toBe(pageIcon);
    expect(widget.title.iconClass).toBe('');
    expect(shell.added).toHaveLength(1);
    expect(shell.added[0].widget).toBe(widget);
    expect(shell.added[0].area).toBe('main');
    expect(shell.activated).toEqual([widget.id]);
    widget.dispose();
  });

  it('ACC-OPEN-287-PAGE-POLICY: policy sandbox null removes the sandbox attribute', async () => {
    const { app } = fakeApp();
    const widget = await app.commands.execute('workspace-page:open', {
      url: URL,
      policy: { sandbox: null }
    });

    expect(frameOf(widget).hasAttribute('sandbox')).toBe(false);
    widget.dispose();
  });

  it('ACC-OPEN-287-PAGE-POLICY: a policy sandbox string, allow, referrerPolicy and csp are applied to the iframe', async () => {
    const { app } = fakeApp();
    const widget = await app.commands.execute('workspace-page:open', {
      url: URL,
      policy: {
        sandbox: 'allow-scripts allow-forms',
        allow: 'clipboard-read',
        referrerPolicy: 'no-referrer',
        csp: "default-src 'self'"
      }
    });
    const frame = frameOf(widget);

    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(frame.getAttribute('allow')).toBe('clipboard-read');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('csp')).toBe("default-src 'self'");
    widget.dispose();
  });

  it('ACC-OPEN-287-PAGE-POLICY: an icon argument sets title.icon from a LabIcon whose svgstr embeds the URL as an image', async () => {
    const { app } = fakeApp();
    const ICON = '/proxy/47987/icon.svg';
    const withIcon = await app.commands.execute('workspace-page:open', {
      url: URL,
      title: 'Workbench page',
      icon: ICON
    });
    const icon = withIcon.title.icon as LabIcon;

    expect(icon).toBeInstanceOf(LabIcon);
    expect(icon.svgstr).toContain(`<image href="${ICON}"`);
    // LabIcon decodes svgstr; the icon must render, not throw on a `%`
    const rendered = icon.element();
    expect(rendered.querySelector('svg image')?.getAttribute('href')).toBe(
      ICON
    );
    withIcon.dispose();
  });

  it('ACC-OPEN-287-PAGE-POLICY: a malformed policy throws naming the field and opens no widget', async () => {
    const { app, shell } = fakeApp();
    const cases: [any, string][] = [
      [{ sandbox: 4 }, 'policy.sandbox'],
      [{ allow: 4 }, 'policy.allow'],
      [{ referrerPolicy: false }, 'policy.referrerPolicy'],
      [{ csp: [] }, 'policy.csp']
    ];

    for (const [policy, field] of cases) {
      await expect(
        app.commands.execute('workspace-page:open', { url: URL, policy })
      ).rejects.toThrow(field);
    }
    await expect(
      app.commands.execute('workspace-page:open', {
        url: URL,
        policy: 'allow-scripts'
      })
    ).rejects.toThrow('policy must be an object');
    expect(shell.added).toHaveLength(0);
  });
});
