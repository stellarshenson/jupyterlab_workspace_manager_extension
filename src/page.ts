import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { MainAreaWidget, WidgetTracker } from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { LabIcon } from '@jupyterlab/ui-components';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { Widget } from '@lumino/widgets';

import { pageIcon } from './icons';

/** What a page may set on its iframe beyond the default sandbox. */
export interface IPagePolicy {
  /** The sandbox value verbatim; null removes the attribute. */
  sandbox?: string | null;
  /** The iframe `allow` attribute. */
  allow?: string;
  /** The iframe `referrerpolicy` attribute. */
  referrerPolicy?: string;
  /** The iframe `csp` attribute. */
  csp?: string;
}

/** What a lab page tab opens: the server-proxy:open arguments, the icon, the policy. */
export interface IPageArgs {
  url: string;
  title?: string;
  /** The id of the tab's content widget, as server-proxy:open sets it. */
  id?: string;
  /** Open the url in a new browser tab and no lab tab. */
  newBrowserTab?: boolean;
  /** An image URL (svg or png) the tab shows as its icon. */
  icon?: string;
  policy?: IPagePolicy;
}

/** The default sandbox: scripts run, the page's origin is opaque. */
const DEFAULT_SANDBOX = 'allow-scripts';

/** server-proxy:open's sandbox, the default for a lab proxy page: it keeps the lab origin. */
const PROXY_SANDBOX =
  'allow-same-origin allow-scripts allow-popups allow-forms allow-downloads allow-modals';

/** The page tabs this command opened that are still open, with the arguments each shows. */
const pages = new Map<MainAreaWidget<Widget>, IPageArgs>();

/** The class of a page tab; the panel keys it `workspace-page:<content id>`, as the layout restorer saves it. */
export const PAGE_CLASS = 'jp-WorkspaceManager-page';

/** The proxied port of a URL on the lab's own origin under /proxy/<port>/ or /proxy/absolute/<port>/. */
function proxyPort(url: URL): string | undefined {
  return url.origin === window.location.origin
    ? /\/proxy\/(?:absolute\/)?(\d+)\//.exec(url.pathname)?.[1]
    : undefined;
}

/** The port a page is on: the proxied port of a lab proxy URL, else the URL's origin. */
function portOf(url: URL): string {
  return proxyPort(url) ?? url.origin;
}

/** A tab icon that renders the image at `url` into the icon's svg. */
function imageIcon(url: string): LabIcon {
  // LabIcon runs svgstr through decodeURIComponent, which throws on `%`, so
  // escape the URL's `%` and use pixel sizes.
  const href = url
    .replace(/%/g, '%25')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  return new LabIcon({
    name: `workspace-page:${url}`,
    svgstr: `<svg xmlns="http://www.w3.org/2000/svg"><image href="${href}" width="16" height="16"/></svg>`
  });
}

const POLICY_ATTRIBUTES: [keyof IPagePolicy, string][] = [
  ['allow', 'allow'],
  ['referrerPolicy', 'referrerpolicy'],
  ['csp', 'csp']
];

/**
 * Validate `policy` and return the iframe attributes it sets.
 *
 * Throws, naming the field, before any widget exists when a field has the
 * wrong type: `sandbox` is a string, null or absent, every other field a
 * string or absent. An absent `sandbox` sets `fallback`.
 */
function policyAttributes(
  policy: IPagePolicy,
  fallback: string
): [string, string][] {
  if (typeof policy !== 'object' || policy === null) {
    throw new Error('workspace-page:open: policy must be an object');
  }
  const attributes: [string, string][] = [];
  for (const [field, attribute] of POLICY_ATTRIBUTES) {
    const value = policy[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string') {
      throw new Error(`workspace-page:open: policy.${field} must be a string`);
    }
    attributes.push([attribute, value]);
  }
  const { sandbox } = policy;
  if (sandbox === undefined) {
    attributes.push(['sandbox', fallback]);
  } else if (sandbox !== null) {
    if (typeof sandbox !== 'string') {
      throw new Error(
        'workspace-page:open: policy.sandbox must be a string or null'
      );
    }
    attributes.push(['sandbox', sandbox]);
  }
  return attributes;
}

/** A new page tab: a MainAreaWidget around a plain iframe, tracked until disposed. */
function createPage(id?: string): MainAreaWidget<Widget> {
  const frame = document.createElement('iframe');
  frame.style.width = '100%';
  frame.style.height = '100%';
  frame.style.border = '0';
  const content = new Widget({ node: frame });
  if (id !== undefined) {
    content.id = id;
  }
  const widget = new MainAreaWidget({ content });
  widget.addClass(PAGE_CLASS);
  frame.addEventListener('load', () => {
    // readable only while the page keeps the lab origin
    const title = frame.contentDocument?.title;
    if (!pages.get(widget)?.title && title) {
      widget.title.label = title;
      frame.title = title;
    }
  });
  widget.disposed.connect(() => pages.delete(widget));
  return widget;
}

/**
 * Show `url` in a tab of the main area, or in a new browser tab with
 * `newBrowserTab`, as server-proxy:open does.
 *
 * A URL on the lab's origin under `/proxy/<port>/` or `/proxy/absolute/<port>/`
 * gets server-proxy:open's sandbox by default, so the page keeps the lab
 * origin, its session, storage, cookies and POSTs. Any other URL is sandboxed
 * to `allow-scripts`: the page's scripts run, but its origin is opaque. A
 * policy replaces either sandbox verbatim, or removes it with null.
 *
 * A page tab this command opened that shows a page on the same port (the
 * proxied port, else the URL's origin) or carries the same `id` is reused:
 * it takes the new attributes, title and icon, loads the url again, and
 * becomes current. A URL on the lab's origin is fetched past the browser cache
 * before the frame loads it, so the frame shows the document the server serves
 * now. Throws, naming the argument, before anything opens when an argument has
 * the wrong type. `tracker` saves the tab in the workspace, once per tab: a
 * reuse saves its entry again with the new arguments.
 */
export function openPage(
  app: JupyterFrontEnd,
  args: IPageArgs,
  tracker: WidgetTracker<MainAreaWidget<Widget>>
): MainAreaWidget<Widget> | undefined {
  if (
    args.newBrowserTab !== undefined &&
    typeof args.newBrowserTab !== 'boolean'
  ) {
    throw new Error('workspace-page:open: newBrowserTab must be a boolean');
  }
  if (args.id !== undefined && typeof args.id !== 'string') {
    throw new Error('workspace-page:open: id must be a string');
  }
  const url = new URL(args.url, document.baseURI);
  const attributes = policyAttributes(
    args.policy ?? {},
    proxyPort(url) ? PROXY_SANDBOX : DEFAULT_SANDBOX
  );
  if (args.newBrowserTab) {
    window.open(args.url, '_blank');
    return undefined;
  }
  // by the url each tab was last given: a tab whose fetch is pending has no src yet
  const tabs = [...pages];
  const [open] =
    tabs.find(([tab]) => args.id !== undefined && tab.content.id === args.id) ??
    tabs.find(
      ([, shown]) =>
        portOf(new URL(shown.url, document.baseURI)) === portOf(url)
    ) ??
    [];
  const widget = open ?? createPage(args.id);
  pages.set(widget, args);
  const frame = widget.content.node as HTMLIFrameElement;
  for (const name of ['sandbox', 'allow', 'referrerpolicy', 'csp']) {
    frame.removeAttribute(name);
  }
  for (const [name, value] of attributes) {
    frame.setAttribute(name, value);
  }
  if (args.title) {
    frame.title = args.title;
    widget.title.label = args.title;
  }
  widget.title.icon = args.icon ? imageIcon(args.icon) : pageIcon;
  if (url.origin === window.location.origin) {
    // shortcut: only the page document is fetched past the cache; its scripts, styles and data follow their server's caching headers, so that server should send Cache-Control: no-store
    const load = () => {
      // only the url last requested for this tab
      if (pages.get(widget) === args) {
        frame.src = args.url;
      }
    };
    fetch(url.href, { cache: 'reload' })
      .then(reply => reply.blob())
      .then(load, load);
  } else {
    frame.src = args.url;
  }
  if (open) {
    void tracker.save(widget);
  } else {
    app.shell.add(widget, 'main');
    void tracker.add(widget);
  }
  app.shell.activateById(widget.id);
  return widget;
}

/** `workspace-page:open`: a page a workspace shows beside its files. */
export const pagePlugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-workspace-manager-extension:page',
  description:
    'Opens a locally served page in a main-area tab, sandboxed unless a policy says otherwise',
  autoStart: true,
  optional: [ITranslator, ILayoutRestorer],
  activate: (
    app: JupyterFrontEnd,
    translator: ITranslator | null,
    restorer?: ILayoutRestorer | null
  ) => {
    const trans = (translator ?? nullTranslator).load(
      '@stellarshenson/jupyterlab-workspace-manager-extension'
    );
    const tracker = new WidgetTracker<MainAreaWidget<Widget>>({
      namespace: 'workspace-page'
    });
    app.commands.addCommand('workspace-page:open', {
      label: trans.__('Open page'),
      icon: pageIcon,
      describedBy: {
        args: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            id: { type: 'string' },
            newBrowserTab: { type: 'boolean' },
            icon: { type: 'string' },
            policy: {
              type: 'object',
              properties: {
                sandbox: { type: ['string', 'null'] },
                allow: { type: 'string' },
                referrerPolicy: { type: 'string' },
                csp: { type: 'string' }
              }
            }
          },
          required: ['url']
        }
      },
      execute: args => openPage(app, args as unknown as IPageArgs, tracker)
    });
    // a page tab reopens with the arguments it last showed, never in a new browser tab
    void restorer?.restore(tracker, {
      command: 'workspace-page:open',
      args: widget => {
        const { url, title, icon, policy } = pages.get(widget)!;
        return {
          url,
          title,
          id: widget.content.id,
          icon,
          policy
        } as unknown as ReadonlyPartialJSONObject;
      },
      name: widget => widget.content.id
    });
  }
};
