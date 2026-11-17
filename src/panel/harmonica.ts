/**
 * The harmonica of the panel's sections (design system, Harmonica navigation): one
 * section is open and takes the panel; the wheel scrolls its list, and at the list's
 * end a fresh gesture folds it into its band while the neighbour opens; a list that
 * cannot scroll passes the wheel straight through.
 * The clock and the drawing come from outside, so a test drives it with a fake clock.
 */

/** The values of the chapter. */
export const GAP_MS = 220; // a pause before a wheel event that starts a fresh gesture
export const PULL_STEP = 3; // px the neighbour eases in per wheel event
export const PULL_MAX = 22; // the cap of the pull
export const RELEASE_MS = 160; // wheel idle before the pull springs back
export const FOLD_MS = 400; // the fold from one section to the next
export const SETTLE_MS = 250; // the wheel ignored after a fold a wheel switch started ends
/** The spring exp(-7t) cos(16t) ends at the second zero of cos(16t), 294.5 ms: settled under 300 ms. */
export const SPRING_MS = (3 * Math.PI * 1000) / 32;

/** Time, timers and animation frames. */
export interface IClock {
  now(): number;
  setTimeout(f: () => void, ms: number): number;
  clearTimeout(id: number): void;
  requestFrame(f: () => void): number;
  cancelFrame(id: number): void;
}

/** What the controller reads from the panel and draws on it; section `i` counts from the top. */
export interface IHarmonicaView {
  /** The base height of the open list: the column of sections less every band, never a list's drawn height. */
  span(): number;
  scrollTop(i: number): number;
  scrollHeight(i: number): number;
  scroll(i: number, top: number): void;
  /** `open` is the open section; `heights` holds the lists a pull or a fold moves, in px, and is null at rest. */
  draw(open: number, heights: Record<number, number> | null): void;
}

const browserClock: IClock = {
  now: () => performance.now(),
  setTimeout: (f, ms) => window.setTimeout(f, ms),
  clearTimeout: id => window.clearTimeout(id),
  requestFrame: f => window.requestAnimationFrame(() => f()),
  cancelFrame: id => window.cancelAnimationFrame(id)
};

export class Harmonica {
  constructor(
    private readonly _view: IHarmonicaView,
    private readonly _count: number,
    private _open: number,
    private readonly _clock: IClock = browserClock
  ) {}

  /** The open section. */
  get open(): number {
    return this._open;
  }

  /** Whether a fold runs. */
  get folding(): boolean {
    return this._folding;
  }

  /** A click, Enter or Space on band `i`: a folded section opens with the fold; the open one stays. */
  select(i: number): void {
    if (i !== this._open) {
      this._fold(i, 0);
    }
  }

  /**
   * One wheel event of `dy` px over the panel: it drives the open section. `native` when
   * it is over the open list, which the browser scrolls itself until the list's end.
   * Returns whether the panel cancels the event.
   */
  wheel(dy: number, native = false): boolean {
    const now = this._clock.now();
    // the fold, and the settle after a wheel switch's fold, swallow the carried momentum
    if (this._folding || now < this._settled) {
      return true;
    }
    const fresh = now - this._last >= GAP_MS;
    this._last = now;
    const dir = Math.sign(dy);
    const i = this._open;
    const top = this._view.scrollTop(i);
    // the base height: a pull that shrank the drawn list must not make it scroll
    const first = top <= 1;
    const last = top >= this._view.scrollHeight(i) - this._view.span() - 1;
    if (!(dir > 0 ? last : first)) {
      this._hold = 0;
      this._release();
      if (native) {
        return false;
      }
      // a whole-pixel scrollTop write drops the fraction: the next event carries it
      const want = top + this._carry + dy;
      this._view.scroll(i, want);
      const left = want - this._view.scrollTop(i);
      this._carry = Math.abs(left) < 1 ? left : 0;
      return true;
    }
    const to = i + dir;
    if (to < 0 || to >= this._count) {
      this._release();
      return true;
    }
    // a list that cannot scroll passes the wheel straight through; at the end of one that
    // scrolls, a fresh gesture after a pull switches, and a held pull or a momentum tail stops there
    if ((first && last) || (this._hold === dir && fresh)) {
      this._fold(to, dir);
      return true;
    }
    this._hold = dir;
    this._pullTo(to);
    return true;
  }

  /** Stop the running timer and frame. */
  stop(): void {
    this._clock.clearTimeout(this._timer);
    this._clock.cancelFrame(this._frame);
  }

  /** The neighbour eases in by a step, and springs back when the wheel stops. */
  private _pullTo(to: number): void {
    this.stop();
    // a pull that turns to the other neighbour starts it from nothing
    this._pull = Math.min(
      PULL_MAX,
      (to === this._to ? this._pull : 0) + PULL_STEP
    );
    this._to = to;
    this._drawPull();
    if (to < this._open) {
      // upward the previous section shows its last rows
      this._view.scroll(to, this._view.scrollHeight(to));
    }
    this._timer = this._clock.setTimeout(() => this._spring(), RELEASE_MS);
  }

  private _drawPull(): void {
    const span = this._view.span();
    this._draw(this._open, {
      [this._open]: span - this._pull,
      [this._to]: this._pull
    });
  }

  /** The damped spring of the pull, t in seconds from its start; it moves no scroll position. */
  private _spring(): void {
    const from = this._pull;
    const start = this._clock.now();
    const frame = (): void => {
      const t = (this._clock.now() - start) / 1000;
      this._pull = from * Math.abs(Math.exp(-7 * t) * Math.cos(16 * t));
      this._drawPull();
      this._frame = this._clock.requestFrame(frame);
    };
    this._timer = this._clock.setTimeout(() => this._release(), SPRING_MS);
    this._frame = this._clock.requestFrame(frame);
  }

  /** End a pull: the lists return to rest. */
  private _release(): void {
    this.stop();
    if (this._to >= 0) {
      this._pull = 0;
      this._to = -1;
      this._draw(this._open, null);
    }
  }

  /** Fold the open section into its band while `to` opens over FOLD_MS; `dir` is the direction of the wheel switch that starts it, 0 for a select. */
  private _fold(to: number, dir: number): void {
    // every list starts from the height on screen: a pull's, a running fold's, or the open span at rest
    const shown = this._drawn ?? { [this._open]: this._view.span() };
    this.stop();
    this._pull = 0;
    this._to = -1;
    this._hold = 0;
    const from = this._open;
    const kept = this._view.scrollTop(from);
    this._open = to;
    this._folding = true;
    const start = this._clock.now();
    const frame = (): void => {
      const p = Math.min(1, (this._clock.now() - start) / FOLD_MS);
      // ease-out cubic: every other list folds from its height to nothing, `to` takes the rest
      const heights: Record<number, number> = {};
      let rest = this._view.span();
      for (const [i, h] of Object.entries(shown)) {
        const height = Math.round(h * Math.pow(1 - p, 3));
        // a leaving list folded to nothing is no longer drawn
        if (+i !== to && height > 0) {
          heights[+i] = height;
          rest -= height;
        }
      }
      heights[to] = Math.max(0, rest);
      this._draw(to, heights);
      // a wheel switch keeps the leaving list at the end it left from, a select keeps its
      // scroll position, which the render's layout of the folded list can clamp; the
      // entering list shows its top, or its bottom upward
      this._view.scroll(
        from,
        dir > 0 ? this._view.scrollHeight(from) : dir < 0 ? 0 : kept
      );
      this._view.scroll(to, dir < 0 ? this._view.scrollHeight(to) : 0);
      if (p < 1) {
        this._frame = this._clock.requestFrame(frame);
        return;
      }
      this._folding = false;
      // a select carries no momentum for a settle to swallow
      if (dir) {
        this._settled = this._clock.now() + SETTLE_MS;
      }
      this._draw(to, null);
    };
    frame();
  }

  /** Draw the lists and keep what is on screen, which the next fold starts from. */
  private _draw(open: number, heights: Record<number, number> | null): void {
    this._drawn = heights;
    this._view.draw(open, heights);
  }

  private _folding = false;
  /** the wheel is ignored until this time */
  private _settled = -Infinity;
  /** the time of the last wheel event */
  private _last = -Infinity;
  /** the fraction of a px the last forwarded scroll could not write */
  private _carry = 0;
  /** the direction of the pull at a list end, 0 for none */
  private _hold = 0;
  /** the pull in px, and the section it shows, -1 for none */
  private _pull = 0;
  private _to = -1;
  /** the heights drawn last, null at rest */
  private _drawn: Record<number, number> | null = null;
  private _timer = 0;
  private _frame = 0;
}
