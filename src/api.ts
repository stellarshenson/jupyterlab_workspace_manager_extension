import {
  KernelAPI,
  ServerConnection,
  SessionAPI,
  TerminalAPI,
  WorkspaceManager
} from '@jupyterlab/services';

import type { IModelInput, IRecord, ITerminal } from './model/model';
import type { Colour } from './model/palette';
import { requestAPI } from './request';

/** Per running kernel id, as the extension's `kernels` route gives it; null when the server cannot read the process. */
export interface IResources {
  [id: string]: { memory: number | null; cpu: number | null };
}

/** A switch request the CLI posted: a workspace to show, a tab to activate, or both. */
export interface ISwitch {
  workspace: string | null;
  tab: string | null;
}

/** What one reload reads from the server; `last` is the colour the rotation gave last. */
export type ILoaded = Pick<
  IModelInput,
  'workspaces' | 'records' | 'terminals' | 'kernels' | 'sessions'
> & { last: Colour | null; resources: IResources };

/** The key of the last given colour in the records the meta route returns. */
const LAST_COLOUR = '/last-colour';

/** A 404 means the server extension is absent: the panel works on without it. */
const ifAbsent =
  <T>(fallback: () => T | Promise<T>) =>
  (reason: unknown): T | Promise<T> => {
    if (
      reason instanceof ServerConnection.ResponseError &&
      reason.response.status === 404
    ) {
      return fallback();
    }
    throw reason;
  };

/**
 * Workspaces, records, terminals with process names, kernels with their memory
 * and CPU, and sessions. A list whose request failed is absent and named in
 * `failed`, with its reason, and the other lists still count; memory and CPU
 * that failed to read are empty and never count as failed.
 */
export async function load(
  settings: ServerConnection.ISettings
): Promise<Partial<ILoaded> & { failed: string[] }> {
  const failed: string[] = [];
  const get = <T>(name: string, request: Promise<T>) =>
    request.catch((reason): undefined => {
      failed.push(`${name} (${reason?.message ?? reason})`);
      return undefined;
    });
  const [list, meta, terminals, kernels, usage, sessions] = await Promise.all([
    get(
      'workspaces',
      new WorkspaceManager({ serverSettings: settings }).list()
    ),
    get(
      'records',
      requestAPI<{ [id: string]: any }>('meta', settings).catch(
        ifAbsent<{ [id: string]: any }>(() => ({}))
      )
    ),
    get(
      'terminals',
      requestAPI<ITerminal[]>('terminals', settings).catch(
        ifAbsent(() =>
          TerminalAPI.isAvailable() ? TerminalAPI.listRunning(settings) : []
        )
      )
    ),
    get(
      'kernels',
      KernelAPI.listRunning(settings).catch(reason => {
        // jupyter_server 2.21 lists a starting kernel before it sets its
        // last_activity and answers 500 then; the second request finds it set
        if (
          reason instanceof ServerConnection.ResponseError &&
          reason.response.status === 500
        ) {
          return KernelAPI.listRunning(settings);
        }
        throw reason;
      })
    ),
    // display only: any failed read shows dashes and blocks no list or action
    requestAPI<IResources>('kernels', settings).catch((): IResources => ({})),
    get('sessions', SessionAPI.listRunning(settings))
  ]);
  const { [LAST_COLOUR]: last, ...records } = meta ?? {};
  return {
    failed,
    ...(list && { workspaces: list.values }),
    ...(meta && { records, last: last ?? null }),
    ...(terminals && { terminals }),
    ...(kernels && { kernels }),
    resources: usage,
    ...(sessions && { sessions })
  };
}

/**
 * Change the named fields of one workspace's record; `given` marks a colour
 * of the rotation, which the server then keeps as the last one given.
 */
export function patchMeta(
  settings: ServerConnection.ISettings,
  id: string,
  change: IRecord & { given?: boolean }
): Promise<IRecord> {
  return requestAPI<IRecord>(`meta/${encodeURIComponent(id)}`, settings, {
    method: 'PATCH',
    body: JSON.stringify(change)
  });
}

/** The workspaces other browser windows showed in the last 90 s; null when the server extension is absent. */
export async function elsewhere(
  settings: ServerConnection.ISettings,
  window: string
): Promise<string[] | null> {
  const reply = await requestAPI<{ workspaces: string[] }>(
    `presence?window=${encodeURIComponent(window)}`,
    settings
  ).catch(ifAbsent(() => null));
  return reply?.workspaces ?? null;
}

/** Report this window's workspace; a report replaces the window's previous one. */
export async function report(
  settings: ServerConnection.ISettings,
  window: string,
  workspace: string
): Promise<void> {
  await requestAPI('presence', settings, {
    method: 'POST',
    body: JSON.stringify({ window, workspace })
  });
}

/**
 * Claim this window's move to a workspace and report it in one operation;
 * false when another live window reports the workspace. A failed request is
 * thrown and the window stays.
 */
export async function claim(
  settings: ServerConnection.ISettings,
  window: string,
  workspace: string
): Promise<boolean> {
  try {
    await requestAPI('presence', settings, {
      method: 'POST',
      body: JSON.stringify({ window, workspace, claim: true })
    });
  } catch (reason) {
    if (
      reason instanceof ServerConnection.ResponseError &&
      reason.response.status === 409
    ) {
      return false;
    }
    throw reason;
  }
  return true;
}

/**
 * The switch requests not yet delivered to this window; the read marks them
 * delivered, so each is applied once. A request with no window id comes to
 * every window that reads.
 */
export async function switches(
  settings: ServerConnection.ISettings,
  window: string
): Promise<ISwitch[]> {
  const reply = await requestAPI<{ requests: ISwitch[] }>(
    `switch?window=${encodeURIComponent(window)}`,
    settings
  ).catch(ifAbsent<{ requests: ISwitch[] }>(() => ({ requests: [] })));
  return reply?.requests ?? [];
}

export const workspaces = (settings: ServerConnection.ISettings) =>
  new WorkspaceManager({ serverSettings: settings });
