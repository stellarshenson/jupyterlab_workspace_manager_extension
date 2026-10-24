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

/** What one reload reads from the server; `last` is the colour the rotation gave last. */
export type ILoaded = Pick<
  IModelInput,
  'workspaces' | 'records' | 'terminals' | 'kernels' | 'sessions'
> & { last: Colour | null };

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
 * Workspaces, records, terminals with process names, kernels and sessions.
 * A list whose request failed is absent and named in `failed`, with its reason,
 * and the other lists still count.
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
  const [list, meta, terminals, kernels, sessions] = await Promise.all([
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
    get('sessions', SessionAPI.listRunning(settings))
  ]);
  const { [LAST_COLOUR]: last, ...records } = meta ?? {};
  return {
    failed,
    ...(list && { workspaces: list.values }),
    ...(meta && { records, last: last ?? null }),
    ...(terminals && { terminals }),
    ...(kernels && { kernels }),
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

/** The workspaces other browser windows showed in the last 90 s. */
export async function elsewhere(
  settings: ServerConnection.ISettings,
  window: string
): Promise<string[]> {
  const reply = await requestAPI<{ workspaces: string[] }>(
    `presence?window=${encodeURIComponent(window)}`,
    settings
  ).catch(ifAbsent(() => ({ workspaces: [] })));
  return reply.workspaces;
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

export const workspaces = (settings: ServerConnection.ISettings) =>
  new WorkspaceManager({ serverSettings: settings });
