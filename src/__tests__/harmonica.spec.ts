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

/** Four lists of `heights` px of rows under a panel whose open list has `span` px; a scroll is clamped to the drawn height, and scrollHeight is never less than it, as in a browser. */
function fakeView(
  heights: number[],
  open: number,
  now: () => number,
  span: number
) {
  const top = heights.map(() => 0);
  const view = {
    open,
    drawn: null as Record<number, number> | null,
    draws: 0,
    /** the time the lists returned to rest */
    restAt: NaN,
    height: (i: number) =>
      view.drawn ? (view.drawn[i] ?? 0) : i === view.open ? span : 0,
    span: () => span,
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

/** A harmonica on four lists of `heights` px with section `open` open, its list at `scrollTop`, under a base height of `span` px. */
function setUp(heights: number[], open: number, scrollTop = 0, span = SPAN) {
  const time = fakeClock();
  const { view, top } = fakeView(heights, open, time.clock.now, span);
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

/** `n` wheel events of `dy` px, `every` ms apart from `from`, each after a frame; returns the time of the last. */
function events(
  s: ReturnType<typeof setUp>,
  from: number,
  n: number,
  dy: number,
  every = 16
): number {
  for (let k = 0; k < n; k++) {
    s.time.frame(from + k * every);
    s.h.wheel(dy);
  }
  return from + (n - 1) * every;
}

describe('harmonica', () => {
  it('ACC-PANEL-308-HARMONICA-WHEEL: under a view that rounds every scrollTop write to a whole pixel, 10 wheel events of 0.4 px forwarded from a band move the open list from 100 to 104, and 10 of -0.4 px move it back to 100; after a downward wheel switch into a list that overflows, a native wheel event over the entering list at 300 ms of the fold returns cancelled and one at the fold end, 400 ms, returns not cancelled', () => {
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

    // native scrolling from the first wheel event after a wheel switch's fold ends
    const n = setUp(LONG, 0, END);
    const fold = events(n, 0, 15, 10);
    expect([n.h.open, n.h.folding]).toEqual([1, true]);
    n.time.frame(fold + 300);
    expect(n.h.wheel(10, true)).toBe(true);
    n.time.frame(fold + 400);
    expect(n.h.folding).toBe(false);
    expect(n.h.wheel(10, true)).toBe(false);
  });

  it('DEF-PANEL-109-SPRING-GIVE, ACC-PANEL-309-HARMONICA-SWITCH: at the last entry of a list that overflows, 10 px events every 16 ms or every 100 ms do not switch on events 1 to 14 and the 15th starts the fold into the next section; after 5 events and a 300 ms pause the first event does not switch, and the switch comes on the event that stretches the pull on screen to 44 px; a stream whose last event comes 16 ms before the fold ends leaves the entered section open at scrollTop 0 2000 ms later; a stream that goes on past the fold end scrolls the entered list from the first event after it; a list scrolled onto its last entry pulls first; upward mirrors it; LANGUAGE SERVERS never switches down, WORKSPACES never up; the boundary reads the base height', () => {
    // a steady stream at the end gives on its 15th event, whatever the pace under 160 ms
    for (const every of [16, 100]) {
      const s = setUp(LONG, 0, END);
      for (let n = 1; n <= 15; n++) {
        events(s, (n - 1) * every, 1, 10);
        expect([s.h.open, s.h.folding]).toEqual(
          n < 15 ? [0, false] : [1, true]
        );
      }
    }

    // a pull, a 300 ms pause in which the spring draws it back, then events every 16 ms
    const paused = setUp(LONG, 0, END);
    const quiet = events(paused, 0, 5, 10);
    for (let t = quiet + 16; t < quiet + 300; t += 16) {
      paused.time.frame(t);
    }
    paused.time.frame(quiet + 300);
    const shown = paused.view.drawn![1];
    expect(shown).toBeLessThan(15);
    const needed = Math.ceil((44 - shown) / 3);
    for (let n = 1; n <= needed; n++) {
      paused.h.wheel(10);
      expect(paused.h.open).toBe(n < needed ? 0 : 1);
      if (n < needed) {
        expect(paused.view.drawn![1]).toBeCloseTo(shown + 3 * n, 9);
        paused.time.frame(quiet + 300 + 16 * n);
      }
    }
    expect(paused.h.folding).toBe(true);

    // a swipe whose last event comes 16 ms before the fold ends crosses one section and stops on it
    const swipe = setUp(LONG, 0, END);
    const give = events(swipe, 0, 15, 10);
    const end = events(swipe, give + 16, 24, 10);
    expect(end).toBe(give + 400 - 16);
    for (let t = end + 16; t <= end + 2000; t += 16) {
      swipe.time.frame(t);
    }
    expect([swipe.h.open, swipe.h.folding, swipe.view.drawn]).toEqual([
      1,
      false,
      null
    ]);
    expect(swipe.top[1]).toBe(0);

    // a scroll that goes on past the fold end scrolls the entered list from the first event after it
    const on = setUp(LONG, 0, END);
    const onGive = events(on, 0, 15, 10);
    events(on, onGive + 16, 24, 10);
    expect([on.h.folding, on.top[1]]).toEqual([true, 0]);
    events(on, onGive + 400, 1, 10);
    expect([on.h.open, on.h.folding, on.top[1]]).toEqual([1, false, 10]);

    // a list scrolled onto its last entry by a wheel event: the next event pulls
    const onto = setUp(LONG, 0, END - 50);
    onto.wheel(0, 100);
    expect(onto.top[0]).toBe(END);
    onto.wheel(220, 100);
    expect(onto.h.open).toBe(0);
    expect(onto.view.drawn).toEqual({ 0: SPAN - 25, 1: 25 });

    // upward at the first entry
    const up = setUp(LONG, 2, 0);
    for (let n = 1; n <= 15; n++) {
      events(up, (n - 1) * 16, 1, -10);
      expect([up.h.open, up.h.folding]).toEqual(
        n < 15 ? [2, false] : [1, true]
      );
    }

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
    // so the list does not scroll and the 15th event switches
    const pulled = setUp(LONG, 0, END);
    for (let n = 0; n < 14; n++) {
      pulled.wheel(n * 100, 10);
      expect(pulled.view.height(0)).toBeLessThan(SPAN);
      expect(pulled.top[0]).toBe(END);
    }
    expect(pulled.h.open).toBe(0);
    pulled.wheel(1400, 10);
    expect(pulled.h.open).toBe(1);
  });

  const pullSteps = () => {
    const s = setUp(LONG, 0, END);
    const pulls: number[] = [];
    for (let n = 0; n < 14; n++) {
      s.wheel(n * 50, 10);
      pulls.push(s.view.drawn![1]);
    }
    const last = 13 * 50;
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

  it('ACC-PANEL-310-HARMONICA-PULL: each 10 px event at the end eases the neighbour in 3 px, 14 events up to 42 px with no switch; 160 ms idle starts the spring exp(-7t) cos(16t), at 0 before t reaches 0.3; a 10 px wheel event during the spring draws the pull on screen plus 3 px; no scroll position moves; prefers-reduced-motion changes nothing; the give length is 44 px from a base height of 88 px and half the base height below it: 30 px at 60 px, 43 px at 87 px, and at 7 px the first event gives; an empty KERNELS list open draws 3 up to 42 px either way and gives on the 15th event', () => {
    const run = pullSteps();
    expect(run.pulls).toEqual([
      3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42
    ]);
    expect(run.held).toBe(42);
    expect(run.spring.length).toBeGreaterThan(10);
    for (const [t, pull] of run.spring) {
      expect(pull).toBeCloseTo(
        42 * Math.abs(Math.exp(-7 * t) * Math.cos(16 * t)),
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

    // a wheel event during the spring stretches the pull on screen
    const during = setUp(LONG, 0, END);
    const quiet = events(during, 0, 5, 10, 50);
    for (let t = quiet + 176; t <= quiet + 224; t += 16) {
      during.time.frame(t);
    }
    const shown = during.view.drawn![1];
    expect(shown).toBeLessThan(15);
    during.h.wheel(10);
    expect(during.view.drawn![1]).toBe(shown + 3);

    // the give length; the give draws it on the fold's first frame
    for (const [span, give] of [
      [60, 30],
      [88, 44],
      [87, 43],
      [7, 3]
    ]) {
      const s = setUp(LONG, 0, 1000 - span, span);
      const pulls: number[] = [];
      for (let n = 0; n < 20 && !s.h.folding; n++) {
        s.wheel(n * 16, 10);
        pulls.push(s.view.drawn![1]);
      }
      const steps = Math.ceil(give / 3);
      expect(pulls).toEqual(
        Array.from({ length: steps }, (_, k) => Math.min(give, 3 * (k + 1)))
      );
      expect([s.h.open, s.h.folding]).toEqual([1, true]);
    }

    // an empty KERNELS list is at its end both ways
    for (const dir of [1, -1]) {
      const s = setUp([1000, 0, 1000, 1000], 1, 0);
      const pulls: number[] = [];
      for (let n = 0; n < 15; n++) {
        s.wheel(n * 16, 10 * dir);
        pulls.push(s.view.drawn![1 + dir]);
      }
      expect(pulls).toEqual([
        3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 44
      ]);
      expect([s.h.open, s.h.folding]).toEqual([1 + dir, true]);
    }
  });

  it('DEF-PANEL-109-SPRING-GIVE-1, ACC-PANEL-309-HARMONICA-SWITCH, ACC-PANEL-310-HARMONICA-PULL: each event at the end stretches the pull by max(3 px, a quarter of its scroll distance): one 6 px event draws 3 px, one 100 px notch 25 px downward and upward; at the last entry of a list that overflows, of 100 px notches 40 ms or 100 ms apart the 1st does not switch and the 2nd starts the fold, and so does the 2nd notch of strokes of two notches 40 ms apart with a 250 ms reposition; lone 100 px notches 250 ms apart do not switch in 40 notches; at a base height of 60 px the 2nd 100 px notch gives', () => {
    const small = setUp(LONG, 0, END);
    small.wheel(0, 6);
    expect(small.view.drawn).toEqual({ 0: SPAN - 3, 1: 3 });
    const notch = setUp(LONG, 0, END);
    notch.wheel(0, 100);
    expect(notch.view.drawn).toEqual({ 0: SPAN - 25, 1: 25 });
    const up = setUp(LONG, 2, 0);
    up.wheel(0, -100);
    expect(up.view.drawn).toEqual({ 2: SPAN - 25, 1: 25 });

    /** 100 px notches at `times` from the last entry under a base height of `span` px; the number of the notch that starts the fold, 0 for none. */
    const switchedOn = (times: number[], span = SPAN) => {
      const s = setUp(LONG, 0, 1000 - span, span);
      for (let n = 0; n < times.length; n++) {
        s.time.frame(times[n]);
        s.h.wheel(100);
        if (s.h.folding) {
          return n + 1;
        }
      }
      return 0;
    };
    expect(switchedOn([0, 40])).toBe(2);
    expect(switchedOn([0, 100])).toBe(2);
    const strokes = Array.from(
      { length: 20 },
      (_, k) => Math.floor(k / 2) * 290 + (k % 2) * 40
    );
    expect(switchedOn(strokes)).toBe(2);
    // the spring draws a lone notch back before the next one comes
    expect(switchedOn(Array.from({ length: 40 }, (_, k) => k * 250))).toBe(0);
    expect(switchedOn([0, 40], 60)).toBe(2);
  });

  it('DEF-PANEL-108-WHEEL-STUCK, DEF-PANEL-109-SPRING-GIVE, ACC-PANEL-309-HARMONICA-SWITCH, ACC-PANEL-310-HARMONICA-PULL: a list that cannot scroll is at its end both ways and needs its own full stretch: after a wheel switch into an empty list, or a 2-row list either way, the first 10 px event after the fold ends draws a 3 px pull, events 1 to 14 after it do not switch and the 15th starts the next fold; with KERNELS and TERMINALS empty, events every 16 ms from the WORKSPACES end open KERNELS on the 15th event, then TERMINALS and LANGUAGE SERVERS each on the 15th event from the end of the previous fold; open as WORKSPACES 2000 ms of upward events, or as LANGUAGE SERVERS of downward events, never switch and draw no pull', () => {
    for (const [heights, from] of [
      [[1000, 0, 1000, 1000], 0],
      [[1000, 48, 1000, 1000], 0],
      [[1000, 48, 1000, 1000], 2]
    ] as [number[], number][]) {
      const dir = 1 - from;
      const s = setUp(heights, from, dir > 0 ? END : 0);
      const give = events(s, 0, 15, 10 * dir);
      expect([s.h.open, s.h.folding]).toEqual([1, true]);
      // the first event after the fold ends
      events(s, give + 400, 1, 10 * dir);
      expect([s.h.open, s.h.folding]).toEqual([1, false]);
      expect(s.view.drawn).toEqual({ 1: SPAN - 3, [1 + dir]: 3 });
      for (let n = 2; n <= 15; n++) {
        events(s, give + 400 + 16 * (n - 1), 1, 10 * dir);
        expect([s.h.open, s.h.folding]).toEqual(
          n < 15 ? [1, false] : [1 + dir, true]
        );
      }
    }

    // a steady stream through two empty sections: every section its own 15 events
    const stream = setUp([1000, 0, 0, 1000], 0, END);
    const opened: number[] = [];
    const ended: number[] = [];
    for (let n = 1, t = 0; t <= 3000; n++, t += 16) {
      const folding = stream.h.folding;
      stream.time.frame(t);
      if (folding && !stream.h.folding) {
        ended.push(n);
      }
      const open = stream.h.open;
      stream.h.wheel(10);
      if (stream.h.open !== open) {
        opened.push(n);
      }
    }
    expect(stream.h.open).toBe(3);
    expect(opened.length).toBe(3);
    expect(opened[0]).toBe(15);
    // event n = ended[k] is the first after a fold ends, so the 15th from it is n + 14
    expect([opened[1] - ended[0], opened[2] - ended[1]]).toEqual([14, 14]);

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

  it('ACC-PANEL-311-HARMONICA-FOLD: a fold runs 400 ms, ease-out cubic, at 200 ms the leaving list 0.125 of the 356 px it had at the 44 px give; a wheel switch pins the leaving list to the end it left from, its bottom downward and its top upward, and a band select keeps its scrollTop 120; the entering list pinned to its top, or to its bottom on an upward switch; a wheel at 300 ms of either fold is cancelled and changes nothing; no settle follows a fold: after a wheel switch a 100 px wheel at the fold end, 400 ms, scrolls the entering list when it overflows and draws a 25 px pull when it cannot scroll, and after the fold of a band select it scrolls the entering list', () => {
    const s = setUp(LONG, 0, END);
    const start = events(s, 0, 15, 10);
    expect(s.h.folding).toBe(true);
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
        const leaving = Math.round(0.125 * (SPAN - 44));
        expect(s.view.drawn).toEqual({ 0: leaving, 1: SPAN - leaving });
      }
      if (t === 300) {
        // a wheel during the fold is cancelled and changes nothing
        const before = JSON.stringify([s.view, s.top]);
        expect(s.h.wheel(100)).toBe(true);
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
    // no settle: a wheel at the fold end scrolls the entering list
    expect(s.top[1]).toBe(0);
    s.h.wheel(100);
    expect(s.top[1]).toBe(100);
    // and stretches the pull of an entering list that cannot scroll
    const empty = setUp([1000, 0, 1000, 1000], 0, END);
    const emptyStart = events(empty, 0, 15, 10);
    empty.time.frame(emptyStart + 400);
    expect(empty.h.folding).toBe(false);
    empty.h.wheel(100);
    expect(empty.view.drawn).toEqual({ 1: SPAN - 25, 2: 25 });

    // upward: the entering list pinned to its bottom, the leaving one to its top
    const up = setUp(LONG, 1, 0);
    const upStart = events(up, 0, 15, -10);
    expect(up.h.open).toBe(0);
    for (let t = upStart + 16; t < upStart + 400; t += 16) {
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
        // a wheel during the fold is cancelled and changes nothing
        const before = JSON.stringify([click.view, click.top]);
        expect(click.h.wheel(100)).toBe(true);
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

  it('ACC-PANEL-311-HARMONICA-FOLD: every fold starts from the heights on screen: a wheel switch at the 44 px give length draws the entering list at 44 px or more on its first frame and never less after; a select during a running fold draws every list on its first frame at the height the running fold drew last', () => {
    const s = setUp(LONG, 0, END);
    for (let t = 0; t <= 13 * 16; t += 16) {
      s.wheel(t, 10);
    }
    expect(s.view.drawn).toEqual({ 0: SPAN - 42, 1: 42 });
    s.wheel(14 * 16, 10);
    expect(s.h.folding).toBe(true);
    let entering = s.view.drawn![1];
    expect(entering).toBeGreaterThanOrEqual(44);
    for (let t = 16; t <= 400; t += 16) {
      s.time.frame(14 * 16 + t);
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
