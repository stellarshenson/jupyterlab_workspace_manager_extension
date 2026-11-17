import {
  Harmonica,
  type IClock,
  type IHarmonicaView
} from '../panel/harmonica';

/** A clock whose time moves only when the test moves it; frames run only on frame(). */
function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; f: () => void }>();
  const frames = new Map<number, () => void>();
  const clock: IClock = {
    now: () => now,
    setTimeout: (f, ms) => {
      timers.set(++id, { at: now + ms, f });
      return id;
    },
    clearTimeout: i => void timers.delete(i),
    requestFrame: f => {
      frames.set(++id, f);
      return id;
    },
    cancelFrame: i => void frames.delete(i)
  };
  return {
    clock,
    /** Move the time to `t`, running every timer due on the way at its own time. */
    to(t: number) {
      for (;;) {
        const due = [...timers]
          .filter(([, x]) => x.at <= t)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        now = due[1].at;
        due[1].f();
      }
      now = t;
    },
    /** Move the time to `t` and run the frames requested so far. */
    frame(t: number) {
      this.to(t);
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(f => f());
    }
  };
}

const SPAN = 400;

/** Four lists of `heights` px of rows under a panel whose open list has SPAN px; a scroll is clamped to the drawn height, and scrollHeight is never less than it, as in a browser. */
function fakeView(heights: number[], open: number, now: () => number) {
  const top = heights.map(() => 0);
  const view = {
    open,
    drawn: null as Record<number, number> | null,
    draws: 0,
    /** the time the lists returned to rest */
    restAt: NaN,
    height: (i: number) =>
      view.drawn ? (view.drawn[i] ?? 0) : i === view.open ? SPAN : 0,
    span: () => SPAN,
    scrollTop: (i: number) => top[i],
    scrollHeight: (i: number) => Math.max(heights[i], view.height(i)),
    scroll: (i: number, t: number) => {
      top[i] = Math.max(0, Math.min(t, heights[i] - view.height(i)));
    },
    draw: (o: number, h: Record<number, number> | null) => {
      view.open = o;
      view.drawn = h;
      view.draws += 1;
      if (!h) {
        view.restAt = now();
      }
    }
  };
  return { view, top };
}

/** A harmonica on four lists of `heights` px with section `open` open, its list at `scrollTop`. */
function setUp(heights: number[], open: number, scrollTop = 0) {
  const time = fakeClock();
  const { view, top } = fakeView(heights, open, time.clock.now);
  top[open] = scrollTop;
  const h = new Harmonica(
    view as IHarmonicaView,
    heights.length,
    open,
    time.clock
  );
  /** One wheel event of `dy` px at time `t`. */
  const wheel = (t: number, dy: number) => {
    time.to(t);
    h.wheel(dy);
  };
  return { h, view, top, time, wheel };
}

const LONG = [1000, 1000, 1000, 1000];
/** the scrollTop of a 1000 px list at its last entry */
const END = 1000 - SPAN;

describe('harmonica', () => {
  it('ACC-PANEL-308-HARMONICA-WHEEL: under a view that rounds every scrollTop write to a whole pixel, 10 wheel events of 0.4 px forwarded from a band move the open list from 100 to 104, and 10 of -0.4 px move it back to 100', () => {
    const s = setUp(LONG, 0, 100);
    const scroll = s.view.scroll;
    s.view.scroll = (i, t) => scroll(i, Math.round(t));
    for (let n = 0; n < 10; n++) {
      s.wheel(n * 16, 0.4);
    }
    expect(s.top[0]).toBe(104);
    for (let n = 10; n < 20; n++) {
      s.wheel(n * 16, -0.4);
    }
    expect(s.top[0]).toBe(100);
  });

  it('ACC-PANEL-309-HARMONICA-SWITCH: at the last entry only a fresh gesture switches: after a pull, an event 220 ms later switches and one 219 ms later does not; a held pull of events every 100 ms for 2000 ms and a decaying momentum tail that reaches the end and runs on past it for over 1000 ms never switch; a list scrolled onto its last entry pulls first; a 16 ms burst stops; upward mirrors it; LANGUAGE SERVERS never switches down, WORKSPACES never up; the boundary reads the base height', () => {
    // one event pulls, then events every 100 ms for 2000 ms never switch
    const held = setUp(LONG, 0, END);
    for (let t = 0; t <= 2000; t += 100) {
      held.wheel(t, 100);
      expect(held.h.open).toBe(0);
      expect(held.h.folding).toBe(false);
    }

    // a momentum tail of 60 events, its gaps growing evenly from 16 ms to 219 ms and its
    // deltas decaying, reaches the end and runs on past it without a switch
    const tail = setUp(LONG, 0, END - 200);
    let at = 0;
    let reached = NaN;
    for (let n = 0; n < 60; n++) {
      if (n > 0) {
        at += 16 + ((219 - 16) * (n - 1)) / 58;
      }
      tail.wheel(at, 60 * Math.pow(0.9, n));
      if (Number.isNaN(reached) && tail.top[0] === END) {
        reached = at;
      }
      expect(tail.h.open).toBe(0);
      expect(tail.h.folding).toBe(false);
    }
    expect(at - reached).toBeGreaterThan(1000);

    // after a pull, an event 220 ms later switches; 219 ms later does not
    const fresh = setUp(LONG, 0, END);
    fresh.wheel(0, 100);
    fresh.wheel(220, 100);
    expect(fresh.h.open).toBe(1);
    const early = setUp(LONG, 0, END);
    early.wheel(0, 100);
    early.wheel(219, 100);
    expect(early.h.open).toBe(0);

    // a list scrolled onto its last entry by a wheel event: the next event, 220 ms later, pulls
    const onto = setUp(LONG, 0, END - 50);
    onto.wheel(0, 100);
    expect(onto.top[0]).toBe(END);
    onto.wheel(220, 100);
    expect(onto.h.open).toBe(0);
    expect(onto.view.drawn).toEqual({ 0: SPAN - 3, 1: 3 });

    // a 16 ms burst that scrolls to the end stops there
    const burst = setUp(LONG, 0, END - 100);
    for (let n = 0; n < 20; n++) {
      burst.wheel(n * 16, 30);
    }
    expect(burst.top[0]).toBe(END);
    expect(burst.h.open).toBe(0);
    expect(burst.h.folding).toBe(false);

    // upward at the first entry: held for 2000 ms, and fresh
    const up = setUp(LONG, 1, 0);
    for (let t = 0; t <= 2000; t += 100) {
      up.wheel(t, -100);
      expect(up.h.open).toBe(1);
    }
    const upFresh = setUp(LONG, 2, 0);
    upFresh.wheel(0, -100);
    upFresh.wheel(219, -100);
    expect(upFresh.h.open).toBe(2);
    upFresh.wheel(439, -100);
    expect(upFresh.h.open).toBe(1);

    // LANGUAGE SERVERS never switches down, WORKSPACES never up, and neither pulls
    const last = setUp(LONG, 3, END);
    const first = setUp(LONG, 0, 0);
    for (const t of [0, 100, 200, 300, 400, 500, 600, 1000]) {
      last.wheel(t, 100);
      first.wheel(t, -100);
    }
    expect([last.h.open, first.h.open]).toEqual([3, 0]);
    expect([last.view.draws, first.view.draws]).toEqual([0, 0]);

    // the pull draws the list shorter; the boundary test still reads the base height,
    // so the list does not scroll and a fresh gesture switches
    const pulled = setUp(LONG, 0, END);
    for (const t of [0, 100, 200, 300, 400]) {
      pulled.wheel(t, 100);
      expect(pulled.view.height(0)).toBeLessThan(SPAN);
      expect(pulled.top[0]).toBe(END);
    }
    expect(pulled.h.open).toBe(0);
    pulled.wheel(620, 100);
    expect(pulled.h.open).toBe(1);
  });

  const pullSteps = () => {
    const s = setUp(LONG, 0, END);
    const pulls: number[] = [];
    for (let n = 0; n < 8; n++) {
      s.wheel(n * 50, 100);
      pulls.push(s.view.drawn![1]);
    }
    const last = 7 * 50;
    // idle 159 ms: the pull holds
    s.time.to(last + 159);
    const held = s.view.drawn![1];
    // the spring from 160 ms idle, frames every 16 ms
    const start = last + 160;
    const spring: [number, number][] = [];
    for (let t = start + 16; s.view.drawn; t += 16) {
      s.time.frame(t);
      if (s.view.drawn) {
        spring.push([(t - start) / 1000, s.view.drawn[1]]);
      }
    }
    return {
      pulls,
      held,
      spring,
      restAfter: s.view.restAt - start,
      tops: [s.top[0], s.top[1]]
    };
  };

  it('ACC-PANEL-310-HARMONICA-PULL: each event at the end eases the neighbour in 3 px up to 22 px; 160 ms idle starts the spring exp(-7t) cos(16t), at 0 before t reaches 0.3; no scroll position moves; prefers-reduced-motion changes nothing', () => {
    const run = pullSteps();
    expect(run.pulls).toEqual([3, 6, 9, 12, 15, 18, 21, 22]);
    expect(run.held).toBe(22);
    expect(run.spring.length).toBeGreaterThan(10);
    for (const [t, pull] of run.spring) {
      expect(pull).toBeCloseTo(
        22 * Math.abs(Math.exp(-7 * t) * Math.cos(16 * t)),
        6
      );
    }
    // the spring passes its first zero and comes back before it settles
    expect(run.spring.some(([t]) => t > Math.PI / 32)).toBe(true);
    expect(run.restAfter).toBeLessThan(300);
    expect(run.tops).toEqual([END, 0]);

    // the same steps while the browser asks for reduced motion
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })) as any;
    try {
      expect(
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ).toBe(true);
      expect(pullSteps()).toEqual(run);
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it('DEF-PANEL-108-WHEEL-STUCK, ACC-PANEL-309-HARMONICA-SWITCH, ACC-PANEL-310-HARMONICA-PULL: a list that cannot scroll passes the wheel straight through: after a wheel switch into an empty list, or a 2-row list either way, an event 249 ms after the fold ends changes nothing and the first event 250 ms after it starts the next fold, whose first frame draws the entering list at 0 px with no pull drawn before; with KERNELS and TERMINALS empty, events every 16 ms from the switch into KERNELS open TERMINALS, then LANGUAGE SERVERS, each on the first event after the previous fold and its 250 ms settle; open as WORKSPACES 2000 ms of upward events, or as LANGUAGE SERVERS of downward events, never switch and draw no pull', () => {
    // a pull, then a fresh gesture, from section `from` into section 1; frames every 16 ms to the fold's end at 620 ms
    const switchInto = (heights: number[], from: number) => {
      const dir = 1 - from;
      const s = setUp(heights, from, dir > 0 ? END : 0);
      s.wheel(0, 100 * dir);
      s.wheel(220, 100 * dir);
      for (let t = 236; t <= 620; t += 16) {
        s.time.frame(t);
      }
      expect([s.h.open, s.h.folding]).toEqual([1, false]);
      return { s, dir };
    };
    for (const [heights, from] of [
      [[1000, 0, 1000, 1000], 0],
      [[1000, 48, 1000, 1000], 0],
      [[1000, 48, 1000, 1000], 2]
    ] as [number[], number][]) {
      const { s, dir } = switchInto(heights, from);
      const draws = s.view.draws;
      s.wheel(620 + 249, 100 * dir);
      expect([s.h.open, s.h.folding, s.view.draws]).toEqual([1, false, draws]);
      s.wheel(620 + 250, 100 * dir);
      expect([s.h.open, s.h.folding, s.view.draws]).toEqual([
        1 + dir,
        true,
        draws + 1
      ]);
      expect(s.view.drawn).toEqual({ 1: SPAN, [1 + dir]: 0 });
    }

    // a steady stream through two empty sections
    const stream = setUp([1000, 0, 0, 1000], 0, END);
    stream.wheel(0, 100);
    stream.wheel(220, 100);
    const opened = [220];
    const ended: number[] = [];
    for (let t = 236; t <= 3000; t += 16) {
      const folding = stream.h.folding;
      stream.time.frame(t);
      if (folding && !stream.h.folding) {
        ended.push(t);
      }
      const open = stream.h.open;
      stream.h.wheel(100);
      if (stream.h.open !== open) {
        opened.push(t);
      }
    }
    expect(stream.h.open).toBe(3);
    expect(opened.length).toBe(3);
    expect(ended.length).toBe(3);
    for (const k of [0, 1]) {
      // the first event of the 16 ms stream at or after the settle's end
      expect(opened[k + 1] - ended[k]).toBeGreaterThanOrEqual(250);
      expect(opened[k + 1] - ended[k]).toBeLessThan(250 + 16);
    }

    // the panel ends
    const top = setUp([48, 1000, 1000, 1000], 0, 0);
    const bottom = setUp([1000, 1000, 1000, 0], 3, 0);
    for (let t = 0; t <= 2000; t += 16) {
      top.wheel(t, -100);
      bottom.wheel(t, 100);
    }
    expect([top.h.open, bottom.h.open]).toEqual([0, 3]);
    expect([top.view.draws, bottom.view.draws]).toEqual([0, 0]);
  });

  it('ACC-PANEL-311-HARMONICA-FOLD: a fold runs 400 ms, ease-out cubic; a wheel switch pins the leaving list to the end it left from, its bottom downward and its top upward, and a band select keeps its scrollTop 120; the entering list pinned to its top, or to its bottom on an upward switch; the wheel ignored through every fold, and for 250 ms after a fold a wheel switch started; after the fold of a band select the wheel scrolls the entering list at 400 ms', () => {
    const s = setUp(LONG, 0, END);
    s.wheel(0, 100);
    s.wheel(220, 100);
    expect(s.h.folding).toBe(true);
    const start = 220;
    const times = [16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 200];
    for (let t = 216; t <= 400; t += 16) {
      times.push(t);
    }
    // a frame at 300 ms, where the test wheels during the fold
    times.push(300, 400);
    times.sort((a, b) => a - b);
    for (const t of times) {
      s.time.frame(start + t);
      if (t === 200) {
        expect(s.view.drawn).toEqual({ 0: 0.125 * SPAN, 1: 0.875 * SPAN });
      }
      if (t === 300) {
        // a wheel during the fold changes nothing
        const before = JSON.stringify([s.view, s.top]);
        s.h.wheel(100);
        expect(JSON.stringify([s.view, s.top])).toBe(before);
      }
      if (t < 400) {
        expect(s.h.folding).toBe(true);
        // pinned on every frame: the leaving list at its bottom, the entering at its top
        expect(s.top[0]).toBe(1000 - s.view.height(0));
        expect(s.top[1]).toBe(0);
      }
    }
    // done at 400 ms: KERNELS takes the span
    expect(s.h.folding).toBe(false);
    expect(s.view.drawn).toBeNull();
    expect(s.view.open).toBe(1);
    expect(s.view.height(1)).toBe(SPAN);
    // the settle: 249 ms after the fold ends the wheel changes nothing, 250 ms after it scrolls
    const end = start + 400;
    s.wheel(end + 249, 100);
    expect(s.top[1]).toBe(0);
    s.wheel(end + 250, 100);
    expect(s.top[1]).toBe(100);

    // upward: the entering list pinned to its bottom, the leaving one to its top
    const up = setUp(LONG, 1, 0);
    up.wheel(0, -100);
    up.wheel(220, -100);
    expect(up.h.open).toBe(0);
    for (let t = 236; t < 620; t += 16) {
      up.time.frame(t);
      expect(up.top[0]).toBe(1000 - up.view.height(0));
      expect(up.top[1]).toBe(0);
    }

    // a band select, the call a band click, Enter or Space, a filter and Create workspace make
    const click = setUp(LONG, 0, 120);
    // the browser's layout of the folded list during a render can clamp its scrollTop
    const draw = click.view.draw;
    click.view.draw = (o, h) => {
      click.top[0] = 0;
      draw(o, h);
    };
    click.h.select(1);
    const frames = [300, 400];
    for (let t = 16; t < 400; t += 16) {
      frames.push(t);
    }
    frames.sort((a, b) => a - b);
    for (const t of frames) {
      click.time.frame(t);
      if (t === 300) {
        // a wheel during the fold changes nothing
        const before = JSON.stringify([click.view, click.top]);
        click.h.wheel(100);
        expect(JSON.stringify([click.view, click.top])).toBe(before);
      }
      if (t < 400) {
        expect(click.h.folding).toBe(true);
        // the leaving list keeps its scroll position, the entering one shows its top
        expect(click.top[0]).toBe(120);
        expect(click.top[1]).toBe(0);
      }
    }
    // no settle follows it: a wheel at the end of the fold, 400 ms, scrolls the entering list
    expect(click.h.folding).toBe(false);
    click.h.wheel(100);
    expect(click.top[1]).toBe(100);
  });

  it('ACC-PANEL-311-HARMONICA-FOLD: every fold starts from the heights on screen: a wheel switch after a 22 px pull draws the entering list at 22 px or more on its first frame and never less after; a select during a running fold draws every list on its first frame at the height the running fold drew last', () => {
    const s = setUp(LONG, 0, END);
    for (let t = 0; t <= 112; t += 16) {
      s.wheel(t, 100);
    }
    expect(s.view.drawn).toEqual({ 0: SPAN - 22, 1: 22 });
    s.wheel(112 + 220, 100);
    expect(s.h.folding).toBe(true);
    let entering = s.view.drawn![1];
    expect(entering).toBeGreaterThanOrEqual(22);
    for (let t = 16; t <= 400; t += 16) {
      s.time.frame(332 + t);
      const height = s.view.height(1);
      expect(height).toBeGreaterThanOrEqual(entering);
      entering = height;
    }
    expect(s.view.drawn).toBeNull();

    // TERMINALS selected 120 ms into a fold from WORKSPACES to KERNELS
    const twice = setUp(LONG, 0, 0);
    twice.h.select(1);
    for (const t of [16, 32, 48, 64, 80, 96, 112]) {
      twice.time.frame(t);
    }
    const last = { ...twice.view.drawn! };
    twice.time.to(120);
    twice.h.select(2);
    expect(twice.view.drawn).toEqual({ ...last, 2: 0 });
  });

  it('ACC-PANEL-312-HARMONICA-CLICK: a click on a folded band opens it with the 400 ms fold; a click on the open band changes no height', () => {
    const s = setUp(LONG, 0, 0);
    s.h.select(2);
    expect(s.h.folding).toBe(true);
    expect(s.view.open).toBe(2);
    s.time.frame(200);
    expect(s.view.drawn![2]).toBe(0.875 * SPAN);
    expect(s.view.drawn![0]).toBe(0.125 * SPAN);
    s.time.frame(400);
    expect(s.view.drawn).toBeNull();
    expect(s.view.height(2)).toBe(SPAN);

    const draws = s.view.draws;
    s.h.select(2);
    s.time.frame(800);
    expect(s.h.folding).toBe(false);
    expect(s.view.draws).toBe(draws);
    expect(s.view.height(2)).toBe(SPAN);
  });
});
