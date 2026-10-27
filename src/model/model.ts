import type {
  Kernel,
  KernelSpec,
  Session,
  Workspace
} from '@jupyterlab/services';
import type { Colour } from './palette';

/** A workspace's record in the extension's file, as `GET meta` returns it per id. */
export interface IRecord {
  purpose?: string;
  colour?: Colour;
  hidden?: boolean;
  /** the place of its card: the cards sort by it, lowest first */
  position?: number;
}

/** A terminal as the extension's `terminals` endpoint, or `/api/terminals`, gives it. */
export interface ITerminal {
  name: string;
  last_activity?: string;
  /** null or absent when the foreground process cannot be read */
  process?: string | null;
}

/**
 * A tab: its layout key (`terminal:7`, `notebook:<path>`, `console:<path>`,
 * `editor:<path>`, ...), the path and name its saved data holds, and the label
 * a live tab of this window shows.
 */
export interface ITab {
  key: string;
  path?: string;
  name?: string;
  title?: string;
}

/** A row under Tabs: a document or another widget. */
export interface ITabRow extends ITab {
  label: string;
}

export interface ITerminalRow {
  name: string;
  process: string | null;
  lastActivity?: string;
  /** the tab title, when this window shows the terminal */
  title?: string;
  /** the other workspaces that hold it; in the TERMINALS section, every one */
  alsoIn: string[];
}

export interface IKernelRow {
  id: string;
  /** the kernelspec id */
  name: string;
  /** the display name of its kernelspec; the id when the spec is unknown */
  label: string;
  /** the tooltip: the kernelspec display name, the session path, then the state */
  title: string;
  /** the session path of its notebook or console; empty without a session */
  path: string;
  /** the notebook's file name or the console's name */
  detail: string;
  /** the execution state: idle, busy, starting and so on */
  state?: string;
  lastActivity?: string;
  dotClass: string;
  alsoIn: string[];
}

export interface ISection {
  /** the workspace id */
  id: string;
  current: boolean;
  /** hidden by its record; never true for this window's workspace */
  hidden: boolean;
  purpose: string;
  colour: Colour | null;
  position?: number;
  created?: string;
  lastModified?: string;
  tabs: ITabRow[];
  terminals: ITerminalRow[];
  kernels: IKernelRow[];
}

export interface IModelInput {
  /** `GET /lab/api/workspaces` values */
  workspaces: Workspace.IWorkspace[];
  records: { [id: string]: IRecord };
  terminals: ITerminal[];
  kernels: Kernel.IModel[];
  sessions: Session.IModel[];
  /** the kernelspecs JupyterLab loaded; null before they load */
  specs: KernelSpec.ISpecModels | null;
  /** this window's workspace id */
  current: string;
  /** the open tabs of this window, which stand for its workspace's saved layout */
  liveTabs: ITab[];
}

/** The panel: one section per workspace, and every running terminal and kernel. */
export interface IModel {
  sections: ISection[];
  /** the TERMINALS section, a workspace's terminal included */
  terminals: ITerminalRow[];
  /** the KERNELS section, a workspace's kernel included */
  kernels: IKernelRow[];
}

/** The details of a row's tooltip, one per line; a missing detail leaves its line out. */
export const lines = (...details: (string | null | undefined)[]): string =>
  details.filter(Boolean).join('\n');

/** The dot of a kernel row: idle, busy, or unknown for every other state. */
export function kernelDot(state: string | undefined): string {
  const dot = state === 'idle' || state === 'busy' ? state : 'unknown';
  return `jp-WorkspaceManager-dot jp-mod-${dot}`;
}

/** Memory in MB under 1 GB, in GB from there; a dash when the server cannot read it. */
export function formatMemory(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number') {
    return '-';
  }
  const mb = bytes / 2 ** 20;
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

/** CPU in percent of one core, whole; a dash when the server cannot read it. */
export function formatCpu(percent: number | null | undefined): string {
  return typeof percent === 'number' ? `${Math.round(percent)}%` : '-';
}

/** The tabs a saved workspace holds, in the main area and the down area. */
export function tabsOf(data: Workspace.IWorkspace['data']): ITab[] {
  const layout = data['layout-restorer:data'] as any;
  const keys: string[] = areaKeys(layout?.main?.dock).concat(
    layout?.down?.widgets ?? []
  );
  return keys.map(key => {
    const saved = (data[key] as any)?.data ?? {};
    return { key, path: saved.path, name: saved.name };
  });
}

/**
 * One section per workspace, hidden ones included and flagged: by stored
 * position, then the workspaces without one oldest first by `created`, by id
 * when `created` is missing. Every running terminal and kernel is returned
 * beside them, with the workspaces that hold it.
 */
export function buildModel(input: IModelInput): IModel {
  const { records, current } = input;
  let workspaces = input.workspaces;
  if (!workspaces.some(w => w.metadata.id === current)) {
    // this window's workspace has its card before its first save
    workspaces = [{ data: {}, metadata: { id: current } }, ...workspaces];
  }

  const kernelById = new Map<string, Kernel.IModel>();
  for (const session of input.sessions) {
    if (session.kernel) {
      kernelById.set(session.kernel.id, session.kernel);
    }
  }
  for (const kernel of input.kernels) {
    kernelById.set(kernel.id, kernel);
  }
  const titles = new Map<string, string | undefined>();
  for (const tab of input.liveTabs) {
    if (prefix(tab.key) === 'terminal') {
      titles.set(suffix(tab.key), tab.title);
    }
  }

  // What each workspace holds, and who holds each terminal and kernel
  const termHolders = new Map<string, string[]>();
  const kernelHolders = new Map<string, string[]>();
  const held = workspaces.map(ws => {
    const id = ws.metadata.id;
    const tabs = id === current ? input.liveTabs : tabsOf(ws.data);
    const terminals = new Set<string>();
    const kernels = new Map<string, Session.IModel>();
    const docs: ITabRow[] = [];
    const seen = new Set<string>();
    for (const tab of tabs) {
      // two views of one document share its key: one row
      if (seen.has(tab.key)) {
        continue;
      }
      seen.add(tab.key);
      const kind = prefix(tab.key);
      if (kind === 'terminal') {
        terminals.add(suffix(tab.key));
        continue;
      }
      const path = tab.path ?? suffix(tab.key);
      docs.push({ ...tab, label: tab.name ?? tab.title ?? basename(path) });
      if (kind !== 'notebook' && kind !== 'console') {
        continue;
      }
      // a kernel belongs to the workspace whose notebook or console has a session on it
      for (const session of input.sessions) {
        if (
          session.type === kind &&
          session.path === path &&
          session.kernel &&
          !kernels.has(session.kernel.id)
        ) {
          kernels.set(session.kernel.id, session);
        }
      }
    }
    terminals.forEach(name => add(termHolders, name, id));
    kernels.forEach((_, kernelId) => add(kernelHolders, kernelId, id));
    return { ws, docs, terminals, kernels };
  });

  const terminalRow = (t: ITerminal, holders: string[], id?: string) => ({
    name: t.name,
    process: t.process ?? null,
    lastActivity: t.last_activity,
    title: titles.get(t.name),
    alsoIn: holders.filter(h => h !== id)
  });
  const kernelRow = (
    k: Kernel.IModel,
    session: Session.IModel | undefined,
    holders: string[],
    id?: string
  ) => {
    const label = input.specs?.kernelspecs[k.name]?.display_name ?? k.name;
    return {
      id: k.id,
      name: k.name,
      label,
      title: lines(label, session?.path, k.execution_state),
      path: session?.path ?? '',
      detail: !session
        ? ''
        : session.type === 'console'
          ? session.name
          : basename(session.path),
      state: k.execution_state,
      lastActivity: k.last_activity,
      dotClass: kernelDot(k.execution_state),
      alsoIn: holders.filter(h => h !== id)
    };
  };

  const sections: ISection[] = held.map(({ ws, docs, terminals, kernels }) => {
    const id = ws.metadata.id;
    const record = records[id] ?? {};
    const rows: IKernelRow[] = [];
    kernels.forEach((session, kernelId) => {
      const kernel = kernelById.get(kernelId);
      if (kernel) {
        rows.push(kernelRow(kernel, session, kernelHolders.get(kernelId)!, id));
      }
    });
    return {
      id,
      current: id === current,
      hidden: id !== current && !!record.hidden,
      purpose: record.purpose ?? '',
      colour: record.colour ?? null,
      position: record.position,
      created: ws.metadata.created,
      lastModified: ws.metadata.last_modified,
      tabs: docs,
      terminals: input.terminals
        .filter(t => terminals.has(t.name))
        .map(t => terminalRow(t, termHolders.get(t.name)!, id)),
      kernels: rows
    };
  });

  // Infinity - Infinity is NaN, which falls through to the next key
  const position = (s: ISection) => s.position ?? Infinity;
  const created = (s: ISection) => Date.parse(s.created ?? '') || Infinity;
  sections.sort(
    (a, b) =>
      position(a) - position(b) ||
      created(a) - created(b) ||
      a.id.localeCompare(b.id)
  );

  return {
    sections,
    terminals: input.terminals.map(t =>
      terminalRow(t, termHolders.get(t.name) ?? [])
    ),
    kernels: Array.from(kernelById.values()).map(k =>
      kernelRow(
        k,
        input.sessions.find(s => s.kernel?.id === k.id),
        kernelHolders.get(k.id) ?? []
      )
    )
  };
}

/** The workspace sections of the panel; `buildModel` adds the terminals and kernels. */
export function buildSections(input: IModelInput): ISection[] {
  return buildModel(input).sections;
}

/**
 * The saved workspace without the tabs `keys`: gone from the main area, the
 * down area and `data`, where the culler reads `terminal:<name>`. An emptied
 * tab area leaves the layout; a terminal or kernel keeps running.
 */
export function withoutTabs(
  ws: Workspace.IWorkspace,
  keys: string[]
): Workspace.IWorkspace {
  const drop = new Set(keys);
  const data: any = JSON.parse(JSON.stringify(ws.data));
  const prune = (area: any): any => {
    if (!area) {
      return null;
    }
    if (area.type === 'tab-area') {
      const widgets = (area.widgets ?? []).filter((k: string) => !drop.has(k));
      return widgets.length
        ? {
            ...area,
            widgets,
            currentIndex: Math.min(area.currentIndex ?? 0, widgets.length - 1)
          }
        : null;
    }
    const kept = (area.children ?? [])
      .map((child: any, i: number) => [prune(child), area.sizes?.[i]])
      .filter(([child]: any[]) => child);
    if (kept.length < 2) {
      return kept.length ? kept[0][0] : null;
    }
    return {
      ...area,
      children: kept.map((k: any[]) => k[0]),
      sizes: kept.map((k: any[]) => k[1])
    };
  };
  const layout = data['layout-restorer:data'];
  if (layout?.main) {
    layout.main.dock = prune(layout.main.dock);
    if (drop.has(layout.main.current)) {
      delete layout.main.current;
    }
  }
  if (layout?.down?.widgets) {
    layout.down.widgets = layout.down.widgets.filter(
      (k: string) => !drop.has(k)
    );
  }
  keys.forEach(key => delete data[key]);
  return { data, metadata: { id: ws.metadata.id } };
}

function areaKeys(area: any): string[] {
  if (!area) {
    return [];
  }
  if (area.type === 'tab-area') {
    return area.widgets ?? [];
  }
  return (area.children ?? []).reduce(
    (keys: string[], child: any) => keys.concat(areaKeys(child)),
    []
  );
}

function add(map: Map<string, string[]>, key: string, id: string): void {
  map.set(key, (map.get(key) ?? []).concat(id));
}

const prefix = (key: string) => key.split(':')[0];
const suffix = (key: string) => key.slice(key.indexOf(':') + 1);
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
