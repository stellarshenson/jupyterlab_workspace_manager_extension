import { Widget } from '@lumino/widgets';

import {
  apply,
  capture,
  forget,
  keep,
  load,
  recall,
  remember,
  scrollNode,
  type IPosition
} from '../panel/position';

/** Where the positions live; the module keeps the key private. */
const POSITIONS =
  '@stellarshenson/jupyterlab-workspace-manager-extension:positions';

/** A tab whose content is a fake editor: its scroller at `scroll`, its cursor at `cursor`. */
function editor(scroll = 0, cursor = { line: 0, column: 0 }) {
  const tab = new Widget();
  const scrollDOM = document.createElement('div');
  scrollDOM.scrollTop = scroll;
  const setCursorPosition = jest.fn();
  (tab as any).content = {
    editor: {
      getCursorPosition: () => cursor,
      setCursorPosition,
      editor: { scrollDOM }
    }
  };
  return { tab, scrollDOM, setCursorPosition };
}

/** A notebook tab: its window at `scroll`, its active cell `cell` at `cellScroll`. */
function notebook(scroll = 0, cell = 0, cellScroll = 0) {
  const tab = new Widget();
  tab.addClass('jp-NotebookPanel');
  const outerNode = document.createElement('div');
  outerNode.scrollTop = scroll;
  const cellDOM = document.createElement('div');
  cellDOM.scrollTop = cellScroll;
  const content = {
    outerNode,
    activeCellIndex: cell,
    activeCell: { editor: { editor: { scrollDOM: cellDOM } } },
    scrollToItem: jest.fn(async () => undefined)
  };
  (tab as any).content = content;
  return { tab, content, outerNode, cellDOM };
}

/** A tab showing a rendered markdown page scrolled to `scroll`. */
function markdown(scroll = 0) {
  const tab = new Widget();
  const content = new Widget();
  content.addClass('jp-MarkdownViewer');
  (tab as any).content = content;
  const scrolled = document.createElement('div');
  scrolled.className = 'jp-RenderedMarkdown';
  scrolled.scrollTop = scroll;
  tab.node.appendChild(scrolled);
  return { tab, scrolled };
}

/** A console tab scrolled to `scroll`. */
function consolePanel(scroll = 0) {
  const tab = new Widget();
  tab.addClass('jp-ConsolePanel');
  const scrolled = document.createElement('div');
  scrolled.className = 'jp-CodeConsole-content';
  scrolled.scrollTop = scroll;
  tab.node.appendChild(scrolled);
  return { tab, scrolled };
}

beforeEach(() => {
  sessionStorage.clear();
  // the notebook's one-frame re-assert runs now
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  sessionStorage.clear();
});

describe('ACC-PANEL-325-FILE-POSITION store', () => {
  it('keeps one entry per workspace, so load returns only that workspace', () => {
    const a: IPosition = {
      kind: 'editor',
      scroll: 12,
      cursor: { line: 1, column: 2 }
    };
    const b: IPosition = { kind: 'notebook', scroll: 34, cell: 5 };
    keep('a', { 'document:one.md': a });
    keep('b', { 'document:two.md': b });
    expect(load('a')).toEqual({ 'document:one.md': a });
    expect(load('b')).toEqual({ 'document:two.md': b });
    // keeping a again replaces its entry and leaves b's untouched
    keep('a', { 'document:three.md': a });
    expect(load('a')).toEqual({ 'document:three.md': a });
    expect(load('b')).toEqual({ 'document:two.md': b });
  });

  it('load returns {} for a missing key, malformed JSON, a non-object and throwing storage', () => {
    expect(load('missing')).toEqual({});
    sessionStorage.setItem(POSITIONS, 'not json');
    expect(load('missing')).toEqual({});
    sessionStorage.setItem(POSITIONS, '[1,2]');
    expect(load('missing')).toEqual({});
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(load('missing')).toEqual({});
    expect(() => keep('a', {})).not.toThrow();
  });

  it('captures and applies a notebook position', () => {
    const source = notebook(300, 4, 80);
    const position = capture(source.tab);
    expect(position).toEqual({
      kind: 'notebook',
      scroll: 300,
      cell: 4,
      cellScroll: 80
    });
    const target = notebook();
    apply(target.tab, position!);
    expect(target.content.activeCellIndex).toBe(4);
    expect(target.cellDOM.scrollTop).toBe(80);
    expect(target.outerNode.scrollTop).toBe(300);
  });

  it('captures and applies an editor position', () => {
    const source = editor(240, { line: 9, column: 3 });
    const position = capture(source.tab);
    expect(position).toEqual({
      kind: 'editor',
      scroll: 240,
      cursor: { line: 9, column: 3 }
    });
    const target = editor();
    apply(target.tab, position!);
    expect(target.scrollDOM.scrollTop).toBe(240);
    expect(target.setCursorPosition).toHaveBeenCalledWith(
      { line: 9, column: 3 },
      { scroll: false }
    );
  });

  it('captures and applies a markdown position', () => {
    const source = markdown(70);
    const position = capture(source.tab);
    expect(position).toEqual({ kind: 'markdown', scroll: 70 });
    const target = markdown();
    apply(target.tab, position!);
    expect(target.scrolled.scrollTop).toBe(70);
  });

  it('captures and applies a console position', () => {
    const source = consolePanel(90);
    const position = capture(source.tab);
    expect(position).toEqual({ kind: 'console', scroll: 90 });
    const target = consolePanel();
    apply(target.tab, position!);
    expect(target.scrolled.scrollTop).toBe(90);
  });

  it('skips a stored kind that does not match the live widget', () => {
    const target = editor();
    apply(target.tab, { kind: 'markdown', scroll: 500 });
    expect(target.scrollDOM.scrollTop).toBe(0);
    expect(target.setCursorPosition).not.toHaveBeenCalled();
    const page = notebook();
    apply(page.tab, {
      kind: 'editor',
      scroll: 500,
      cursor: { line: 1, column: 1 }
    });
    expect(page.outerNode.scrollTop).toBe(0);
    expect(page.content.activeCellIndex).toBe(0);
  });
});

describe('ACC-PANEL-325-FILE-POSITION memory', () => {
  afterEach(() => {
    forget('a');
    forget('b');
  });

  it('remembers every tab of a workspace and forgets one workspace only', () => {
    expect(recall('a')).toEqual({});
    const one: IPosition = { kind: 'editor', scroll: 12 };
    const two: IPosition = { kind: 'notebook', scroll: 34, cell: 2 };
    remember('a', 'document:one.md', one);
    remember('a', 'notebook:two.ipynb', two);
    remember('b', 'document:one.md', { kind: 'editor', scroll: 56 });
    expect(recall('a')).toEqual({
      'document:one.md': one,
      'notebook:two.ipynb': two
    });
    expect(recall('b')).toEqual({
      'document:one.md': { kind: 'editor', scroll: 56 }
    });
    forget('a');
    expect(recall('a')).toEqual({});
    expect(recall('b')).toEqual({
      'document:one.md': { kind: 'editor', scroll: 56 }
    });
  });

  it('names the scroll box of each kind, and none for a tab that keeps no position', () => {
    const page = notebook();
    expect(scrollNode(page.tab)).toBe(page.outerNode);
    const text = editor();
    expect(scrollNode(text.tab)).toBe(text.scrollDOM);
    const rendered = markdown();
    expect(scrollNode(rendered.tab)).toBe(rendered.scrolled);
    const terminal = consolePanel();
    expect(scrollNode(terminal.tab)).toBe(terminal.scrolled);
    expect(scrollNode(new Widget())).toBeNull();
  });
});
