const TIME_ZONE = "Europe/London";
export const SLOT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

function parts(date: Date): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") result[part.type] = part.value;
  }
  return result;
}

/** Start of the half-hour slot containing the given instant. */
export function slotStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / SLOT_MS) * SLOT_MS);
}

/** Start of the half-hour slot after the one containing the given instant. */
export function nextSlotStart(date: Date): Date {
  return new Date(slotStart(date).getTime() + SLOT_MS);
}

export function londonTime(date: Date): string {
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}

export function londonDate(date: Date): string {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function londonHour(date: Date): number {
  return Number(parts(date).hour);
}

export function londonMinute(date: Date): number {
  return Number(parts(date).minute);
}

export function londonWeekday(date: Date): string {
  return parts(date).weekday;
}

/** "Today", "Tomorrow", or the short weekday, by London calendar date. */
export function dayLabel(date: Date, now: Date): string {
  const target = londonDate(date);
  if (target === londonDate(now)) return "Today";
  if (target === londonDate(new Date(now.getTime() + DAY_MS))) return "Tomorrow";
  return londonWeekday(date);
}
