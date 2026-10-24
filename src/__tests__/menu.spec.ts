import { DeleteArm } from '../model/menu';

describe('Delete workspace', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ACC-ACCORD-31-DELETE: the first click arms, the second of a double-click does not delete, a separate click does', () => {
    const arm = new DeleteArm(() => undefined);
    expect(arm.click({ detail: 1, timeStamp: 1000 })).toBe(false);
    expect(arm.armed).toBe(true);

    expect(arm.click({ detail: 2, timeStamp: 1300 })).toBe(false);
    expect(arm.armed).toBe(true);

    expect(arm.click({ detail: 1, timeStamp: 2000 })).toBe(true);
    expect(arm.armed).toBe(false);
  });

  it('ACC-ACCORD-31-DELETE: a click 600 ms after arming deletes whatever its detail', () => {
    const arm = new DeleteArm(() => undefined);
    arm.click({ detail: 1, timeStamp: 1000 });
    expect(arm.click({ detail: 2, timeStamp: 1600 })).toBe(true);
  });

  it('ACC-ACCORD-103-DELETE-DISARM: the arm lapses after 4 s and when the menu closes', () => {
    const changed = jest.fn();
    const arm = new DeleteArm(changed);

    arm.click({ detail: 1, timeStamp: 0 });
    jest.advanceTimersByTime(3999);
    expect(arm.armed).toBe(true);
    jest.advanceTimersByTime(1);
    expect(arm.armed).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    // the next click arms again
    expect(arm.click({ detail: 1, timeStamp: 5000 })).toBe(false);
    expect(arm.armed).toBe(true);

    arm.disarm();
    expect(arm.armed).toBe(false);
    expect(arm.click({ detail: 1, timeStamp: 9000 })).toBe(false);
    expect(arm.armed).toBe(true);
    // the menu-close disarm stopped the earlier lapse timer
    arm.disarm();
    jest.advanceTimersByTime(10000);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
