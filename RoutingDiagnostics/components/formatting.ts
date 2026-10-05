/** Date and duration formatting, shared by every panel.
 *
 *  Dates are never computed here. Dataverse returns every datetime twice: the raw
 *  UTC value and, under the FormattedValue annotation, the platform's own rendering
 *  in the person's Dynamics time zone and date format. The services keep both, the
 *  panels show the platform's string as given, and the raw value is used only for
 *  sorting and for measuring durations, where the time zone plays no part. */

/** The platform's rendering of a stored datetime, or a dash when the row carried
 *  none. */
export function stamp(label: string | null | undefined): string {
  return label && label.length > 0 ? label : "\u2014";
}

/** Durations are read at a glance, so they stay coarse: a support engineer cares
 *  that something waited eleven minutes, not that it waited 11m 19.4s. */
export function formatDuration(ms: number | null): string {
  if (ms === null || isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function durationBetween(from: string | null, to: string | null): number | null {
  if (!from) return null;
  const start = Date.parse(from);
  const end = to ? Date.parse(to) : Date.now();
  if (isNaN(start) || isNaN(end)) return null;
  return end - start;
}

/** "in queue 59m and counting" reads better than a closed interval when the work
 *  item is still open, so the caller needs to know which it is. */
export function elapsedLabel(from: string | null, to: string | null): string {
  const ms = durationBetween(from, to);
  if (ms === null) return "—";
  return to ? formatDuration(ms) : `${formatDuration(ms)} and counting`;
}

export function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function prettyJson(text: string | null): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}