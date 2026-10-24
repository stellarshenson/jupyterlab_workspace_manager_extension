export interface IAge {
  /** now, Nm, Nh or Nd; empty when the time is unknown */
  label: string;
  /** `jp-mod-now` sets the label semibold in `--jp-ui-font-color0` */
  className: string;
  /** true when the activity dot stands before the label */
  dot: boolean;
}

/**
 * Time since `time` (ISO 8601) at `now` (ms) in the design system's labels.
 * Under 60 s it reads now, with the activity dot; 60 s reads 1m.
 */
export function age(time: string | undefined, now: number): IAge {
  const seconds = (now - Date.parse(time ?? '')) / 1000;
  if (Number.isNaN(seconds)) {
    return { label: '', className: 'jp-WorkspaceManager-age', dot: false };
  }
  if (seconds < 60) {
    return {
      label: 'now',
      className: 'jp-WorkspaceManager-age jp-mod-now',
      dot: true
    };
  }
  const minutes = Math.floor(seconds / 60);
  const label =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
  return { label, className: 'jp-WorkspaceManager-age', dot: false };
}
