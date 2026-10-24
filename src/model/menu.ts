/**
 * The design system's two-step Delete workspace: the first click arms Confirm
 * delete, a separate second click deletes. The arm lapses after 4 s, or when
 * the menu closes (`disarm`). `changed` runs when the arm lapses by itself.
 */
export class DeleteArm {
  constructor(changed: () => void) {
    this._changed = changed;
  }

  get armed(): boolean {
    return this._armed;
  }

  /** One click on the item, with its event's `detail` and `timeStamp`; true when it deletes. */
  click(event: { detail: number; timeStamp: number }): boolean {
    if (!this._armed) {
      this._armed = true;
      this._armedAt = event.timeStamp;
      this._timer = setTimeout(() => {
        this.disarm();
        this._changed();
      }, 4000);
      return false;
    }
    // The second click of a double-click within 600 ms of arming does not
    // confirm; a later click does, whatever its detail, as the OS
    // double-click interval can be longer than the user's pause.
    if (event.detail > 1 && event.timeStamp - this._armedAt < 600) {
      return false;
    }
    this.disarm();
    return true;
  }

  disarm(): void {
    this._armed = false;
    clearTimeout(this._timer);
  }

  private _changed: () => void;
  private _armed = false;
  private _armedAt = 0;
  private _timer: ReturnType<typeof setTimeout> | undefined;
}
