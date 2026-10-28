export interface IAge {
  /** now, Nm ago, Nh ago, Nd ago, Nmo ago or Ny ago; never when the time is unknown */
  label: string;
  /** the class of the row or card header: `jp-mod-recentlyActive` under 60 s, `jp-mod-stale` over 7 days, else empty */
  mod: string;
}

const DAY = 86400;

/**
 * Time since `time` (ISO 8601) at `now` (ms) in the design system's labels, with
 * whole-number floors; the label now and the recent emphasis share the 60 s threshold.
 */
export function age(time: string | undefined, now: number): IAge {
  const s = (now - Date.parse(time ?? '')) / 1000;
  if (Number.isNaN(s)) {
    return { label: 'never', mod: '' };
  }
  if (s < 60) {
    return { label: 'now', mod: 'jp-mod-recentlyActive' };
  }
  const [n, unit] =
    s < 3600
      ? [s / 60, 'm']
      : s < DAY
        ? [s / 3600, 'h']
        : s < 30 * DAY
          ? [s / DAY, 'd']
          : s < 365 * DAY
            ? [s / (30 * DAY), 'mo']
            : [s / (365 * DAY), 'y'];
  return {
    label: `${Math.floor(n)}${unit} ago`,
    mod: s > 7 * DAY ? 'jp-mod-stale' : ''
  };
}
