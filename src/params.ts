export const DEFAULT_DURATIONS = [2, 3];
const MAX_DURATIONS = 4;
const MIN_HOURS = 0.5;
const MAX_HOURS = 12;

/**
 * Parses "2,3" into [2, 3]. Order and duplicates are preserved because the
 * template pairs each window with an appliance name by position.
 */
export function parseDurations(raw: string | undefined): number[] | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DURATIONS;
  const values = raw.split(",").map((part) => Number(part.trim()));
  if (values.length > MAX_DURATIONS) return null;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    if (value < MIN_HOURS || value > MAX_HOURS) return null;
    if (!Number.isInteger(value * 2)) return null;
  }
  return values;
}

/** undefined when not supplied, null when unparseable, otherwise the instant. */
export function parseAt(raw: string | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
