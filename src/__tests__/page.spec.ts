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
const OFF_ORIGIN = 'http://127.0.0.1:47987/workbench-card-mockup.html';
const PROXY_SANDBOX =
  'allow-same-origin allow-scripts allow-popups allow-forms allow-downloads allow-modals';

/** Let the fetches the command started settle. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** The iframe a widget shows. */
function frameOf(widget: any): HTMLIFrameElement {
  return widget.node.querySelector('iframe') as HTMLIFrameElement;
}

describe('workspace-page:open', () => {
  // the command fetches a lab-origin url before the frame loads it; no server here
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest
      .spyOn(window, 'fetch')
      .mockImplementation(async () => new Response(''));
  });
  afterEach(() => fetchSpy.mockRestore());

  it('ACC-OPEN-287-PAGE-POLICY: without a policy a URL that is not a lab proxy URL is sandboxed to allow-scripts and the tab takes the given title with the standard page icon', async () => {
    const { app, shell } = fakeApp();
    expect(app.commands.hasCommand('workspace-page:open')).toBe(true);

    const widget = await app.commands.execute('workspace-page:open', {
      url: OFF_ORIGIN,
      title: 'Workbench page'
    });
    const frame = frameOf(widget);

    expect(frame.getAttribute('src')).toBe(OFF_ORIGIN);
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

  it('ACC-OPEN-293-PROXY-SANDBOX: without a policy a lab /proxy/<port>/ or /proxy/absolute/<port>/ URL gets the server-proxy:open sandbox list', async () => {
    const { app } = fakeApp();
    for (const url of [URL, '/proxy/absolute/47988/index.html']) {
      const widget = await app.commands.execute('workspace-page:open', {
        url
      });

      expect(frameOf(widget).getAttribute('sandbox')).toBe(PROXY_SANDBOX);
      widget.dispose();
    }
  });

  it('ACC-OPEN-293-PROXY-SANDBOX: another origin and a lab path outside /proxy/ keep allow-scripts', async () => {
    const { app } = fakeApp();
    for (const url of [
      OFF_ORIGIN,
      'http://example.com/proxy/47987/index.html',
      '/files/page.html'
    ]) {
      const widget = await app.commands.execute('workspace-page:open', {
        url
      });

      expect(frameOf(widget).getAttribute('sandbox')).toBe('allow-scripts');
      widget.dispose();
    }
  });

  it('ACC-OPEN-293-PROXY-SANDBOX: policy.sandbox string and null replace the proxy default', async () => {
    const { app } = fakeApp();
    const custom = await app.commands.execute('workspace-page:open', {
      url: URL,
      policy: { sandbox: 'allow-scripts allow-forms' }
    });
    expect(frameOf(custom).getAttribute('sandbox')).toBe(
      'allow-scripts allow-forms'
    );
    custom.dispose();

    const none = await app.commands.execute('workspace-page:open', {
      url: URL,
      policy: { sandbox: null }
    });
    expect(frameOf(none).hasAttribute('sandbox')).toBe(false);
    none.dispose();
  });

  it('ACC-OPEN-294-PROXY-ARGS: newBrowserTab true calls window.open(url, "_blank") and adds no widget', async () => {
    const { app, shell } = fakeApp();
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);

    const result = await app.commands.execute('workspace-page:open', {
      url: URL,
      newBrowserTab: true
    });

    expect(open).toHaveBeenCalledWith(URL, '_blank');
    expect(result).toBeUndefined();
    expect(shell.added).toHaveLength(0);
    open.mockRestore();
  });

  it('ACC-OPEN-294-PROXY-ARGS: id sets the id of the content widget', async () => {
    const { app } = fakeApp();
    const widget = await app.commands.execute('workspace-page:open', {
      url: URL,
      id: 'my-page'
    });

    expect(widget.content.id).toBe('my-page');
    expect(frameOf(widget).id).toBe('my-page');
    widget.dispose();
  });

  it('ACC-OPEN-294-PROXY-ARGS: the command describes its six arguments, url required', async () => {
    const { app } = fakeApp();
    const { args } = (await app.commands.describedBy(
      'workspace-page:open'
    )) as any;

    expect(Object.keys(args.properties)).toEqual([
      'url',
      'title',
      'id',
      'newBrowserTab',
      'icon',
      'policy'
    ]);
    expect(args.properties.newBrowserTab.type).toBe('boolean');
    expect(args.required).toEqual(['url']);
  });

  it('ACC-OPEN-294-PROXY-ARGS: a non-boolean newBrowserTab or a non-string id throws naming the argument and opens nothing', async () => {
    const { app, shell } = fakeApp();
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);

    await expect(
      app.commands.execute('workspace-page:open', {
        url: URL,
        newBrowserTab: 'yes'
      })
    ).rejects.toThrow('newBrowserTab must be a boolean');
    await expect(
      app.commands.execute('workspace-page:open', { url: URL, id: 4 })
    ).rejects.toThrow('id must be a string');

    expect(open).not.toHaveBeenCalled();
    expect(shell.added).toHaveLength(0);
    open.mockRestore();
  });

  it('ACC-OPEN-295-PORT-RELOAD: a second open on the same proxy port with another path, title and icon reuses the tab, points it at the new url and activates it', async () => {
    const { app, shell } = fakeApp();
    const first = await app.commands.execute('workspace-page:open', {
      url: URL,
      title: 'First',
      policy: { sandbox: null, allow: 'clipboard-read' }
    });
    const ICON = '/proxy/47987/icon.svg';
    const NEXT = '/proxy/47987/other.html?v=2';
    const second = await app.commands.execute('workspace-page:open', {
      url: NEXT,
      title: 'Second',
      icon: ICON
    });
    await settle();
    const frame = frameOf(second);

    expect(second).toBe(first);
    expect(shell.added).toHaveLength(1);
    expect(frame.getAttribute('src')).toBe(NEXT);
    expect(second.title.label).toBe('Second');
    expect(frame.title).toBe('Second');
    expect((second.title.icon as LabIcon).svgstr).toContain(
      `<image href="${ICON}"`
    );
    // the new arguments set no policy: the proxy default returns, allow goes
    expect(frame.getAttribute('sandbox')).toBe(PROXY_SANDBOX);
    expect(frame.hasAttribute('allow')).toBe(false);
    expect(shell.activated).toEqual([first.id, first.id]);
    second.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: a lab-origin open returns the widget before its fetch settles, fetches the url with cache reload, and sets src to the url only once the fetch settles', async () => {
    const { app } = fakeApp();
    let reply: (response: Response) => void = () => undefined;
    fetchSpy.mockImplementation(
      () => new Promise<Response>(resolve => (reply = resolve))
    );
    const widget = await app.commands.execute('workspace-page:open', {
      url: URL
    });
    const frame = frameOf(widget);

    expect(fetchSpy.mock.calls).toEqual([
      [`${location.origin}${URL}`, { cache: 'reload' }]
    ]);
    expect(frame.hasAttribute('src')).toBe(false);
    reply(new Response(''));
    await settle();
    expect(frame.getAttribute('src')).toBe(URL);
    widget.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: a url on another origin sets src at once and is not fetched', async () => {
    const { app } = fakeApp();
    const widget = await app.commands.execute('workspace-page:open', {
      url: OFF_ORIGIN
    });

    expect(frameOf(widget).getAttribute('src')).toBe(OFF_ORIGIN);
    expect(fetchSpy).not.toHaveBeenCalled();
    widget.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: a rejected fetch still sets src', async () => {
    const { app } = fakeApp();
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    const widget = await app.commands.execute('workspace-page:open', {
      url: URL
    });
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(frameOf(widget).getAttribute('src')).toBe(URL);
    widget.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: two quick opens on one port end on the second url when the first fetch settles last', async () => {
    const { app, shell } = fakeApp();
    const replies: ((response: Response) => void)[] = [];
    fetchSpy.mockImplementation(
      () => new Promise<Response>(resolve => replies.push(resolve))
    );
    const NEXT = '/proxy/47987/other.html';
    const first = await app.commands.execute('workspace-page:open', {
      url: URL
    });
    const second = await app.commands.execute('workspace-page:open', {
      url: NEXT
    });
    replies[1](new Response(''));
    await settle();
    replies[0](new Response(''));
    await settle();

    expect(second).toBe(first);
    expect(shell.added).toHaveLength(1);
    expect(frameOf(second).getAttribute('src')).toBe(NEXT);
    second.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: a reuse without a title or icon takes the page document title once it loads and the standard page icon', async () => {
    const { app } = fakeApp();
    const widget = await app.commands.execute('workspace-page:open', {
      url: URL,
      title: 'First',
      icon: '/proxy/47987/icon.svg'
    });
    const frame = frameOf(widget);
    Object.defineProperty(frame, 'contentDocument', {
      get: () => ({ title: 'Page title' })
    });
    // a page opened with a title keeps it when its document loads
    frame.dispatchEvent(new Event('load'));
    expect(widget.title.label).toBe('First');

    const again = await app.commands.execute('workspace-page:open', {
      url: URL
    });
    frame.dispatchEvent(new Event('load'));

    expect(again).toBe(widget);
    expect(widget.title.label).toBe('Page title');
    expect(frame.title).toBe('Page title');
    expect(widget.title.icon).toBe(pageIcon);
    widget.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: URLs off the lab proxy share a tab by origin, and /proxy/<port>/ and /proxy/absolute/<port>/ share one by port', async () => {
    const { app, shell } = fakeApp();
    const first = await app.commands.execute('workspace-page:open', {
      url: OFF_ORIGIN
    });
    const sameOrigin = await app.commands.execute('workspace-page:open', {
      url: 'http://127.0.0.1:47987/other.html'
    });
    const otherOrigin = await app.commands.execute('workspace-page:open', {
      url: 'http://127.0.0.1:47988/workbench-card-mockup.html'
    });
    const proxied = await app.commands.execute('workspace-page:open', {
      url: '/proxy/47990/index.html'
    });
    const absolute = await app.commands.execute('workspace-page:open', {
      url: '/proxy/absolute/47990/other.html'
    });

    expect(sameOrigin).toBe(first);
    expect(otherOrigin).not.toBe(first);
    expect(absolute).toBe(proxied);
    expect(proxied).not.toBe(first);
    expect(shell.added).toHaveLength(3);
    first.dispose();
    otherOrigin.dispose();
    proxied.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: the same id on another port reuses the tab', async () => {
    const { app, shell } = fakeApp();
    const first = await app.commands.execute('workspace-page:open', {
      url: URL,
      id: 'my-page'
    });
    const second = await app.commands.execute('workspace-page:open', {
      url: OFF_ORIGIN,
      id: 'my-page'
    });

    expect(second).toBe(first);
    expect(shell.added).toHaveLength(1);
    expect(frameOf(second).getAttribute('src')).toBe(OFF_ORIGIN);
    expect(frameOf(second).getAttribute('sandbox')).toBe('allow-scripts');
    second.dispose();
  });

  it('ACC-OPEN-295-PORT-RELOAD: a disposed tab is not reused, and another port opens its own tab', async () => {
    const { app, shell } = fakeApp();
    const first = await app.commands.execute('workspace-page:open', {
      url: URL
    });
    first.dispose();
    const second = await app.commands.execute('workspace-page:open', {
      url: URL
    });
    const other = await app.commands.execute('workspace-page:open', {
      url: '/proxy/47988/index.html'
    });

    expect(second).not.toBe(first);
    expect(other).not.toBe(second);
    expect(shell.added).toHaveLength(3);
    second.dispose();
    other.dispose();
  });
});
