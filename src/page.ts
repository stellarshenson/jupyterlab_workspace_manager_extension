import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { MainAreaWidget } from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { LabIcon } from '@jupyterlab/ui-components';
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

/** What a lab page tab opens: the URL, the title, the icon, the policy. */
export interface IPageArgs {
  url: string;
  title?: string;
  /** An image URL (svg or png) the tab shows as its icon. */
  icon?: string;
  policy?: IPagePolicy;
}

/** The default sandbox: scripts run, the page's origin is opaque. */
const DEFAULT_SANDBOX = 'allow-scripts';

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
 * string or absent.
 */
function policyAttributes(policy: IPagePolicy): [string, string][] {
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
    attributes.push(['sandbox', DEFAULT_SANDBOX]);
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

/**
 * Show `url` in a tab of the main area.
 *
 * The iframe is sandboxed to `allow-scripts` by default: the page's scripts
 * run, but its origin is opaque, so it has no lab session, storage or cookies
 * and its requests do not reach the lab. A policy replaces the sandbox value
 * verbatim, or removes it with null so a page under `/proxy/<port>/` keeps the
 * lab origin, its storage and its POSTs.
 */
export function openPage(
  app: JupyterFrontEnd,
  args: IPageArgs
): MainAreaWidget<Widget> {
  const attributes = policyAttributes(args.policy ?? {});
  const frame = document.createElement('iframe');
  frame.src = args.url;
  for (const [name, value] of attributes) {
    frame.setAttribute(name, value);
  }
  if (args.title) {
    frame.title = args.title;
  }
  frame.style.width = '100%';
  frame.style.height = '100%';
  frame.style.border = '0';
  const widget = new MainAreaWidget({ content: new Widget({ node: frame }) });
  widget.title.label = args.title ?? '';
  widget.title.icon = args.icon ? imageIcon(args.icon) : pageIcon;
  if (!args.title) {
    // readable only while the page keeps the lab origin
    frame.addEventListener('load', () => {
      const title = frame.contentDocument?.title;
      if (title) {
        widget.title.label = title;
        frame.title = title;
      }
    });
  }
  app.shell.add(widget, 'main');
  app.shell.activateById(widget.id);
  return widget;
}

/** `workspace-page:open`: a page a workspace shows beside its files. */
export const pagePlugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-workspace-manager-extension:page',
  description:
    'Opens a locally served page in a main-area tab, sandboxed unless a policy says otherwise',
  autoStart: true,
  optional: [ITranslator],
  activate: (app: JupyterFrontEnd, translator: ITranslator | null) => {
    const trans = (translator ?? nullTranslator).load(
      '@stellarshenson/jupyterlab-workspace-manager-extension'
    );
    app.commands.addCommand('workspace-page:open', {
      label: trans.__('Open page'),
      icon: pageIcon,
      describedBy: {
        args: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
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
      execute: args => openPage(app, args as unknown as IPageArgs)
    });
  }
};
