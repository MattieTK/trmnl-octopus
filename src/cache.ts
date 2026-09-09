import { nextSlotStart, SLOT_MS } from "./time";

/** Synthetic origin for Cache API keys; never fetched. */
const KEY_ORIGIN = "https://cache.trmnl-octopus.internal";

export const LAST_GOOD_TTL_SECONDS = 48 * 60 * 60;
export const PENDING_TTL_SECONDS = 5 * 60;
const MIN_TTL_SECONDS = 30;

function durationsKey(durations: number[]): string {
  return durations.join(",");
}

/** Key for the cached payload of one region, duration list and half-hour period. */
export function periodKey(region: string, durations: number[], now: Date): Request {
  const period = Math.floor(now.getTime() / SLOT_MS);
  return new Request(`${KEY_ORIGIN}/trmnl?region=${region}&durations=${durationsKey(durations)}&period=${period}`);
}

/** Key for the most recent successful payload, served when upstream fails. */
export function lastGoodKey(region: string, durations: number[]): Request {
  return new Request(`${KEY_ORIGIN}/last-good?region=${region}&durations=${durationsKey(durations)}`);
}

/** Seconds until the next half hour, shortened to five minutes while tomorrow's prices are awaited. */
export function ttlSeconds(now: Date, tomorrowPending: boolean): number {
  const untilBoundary = Math.ceil((nextSlotStart(now).getTime() - now.getTime()) / 1000);
  const ttl = tomorrowPending ? Math.min(untilBoundary, PENDING_TTL_SECONDS) : untilBoundary;
  return Math.max(ttl, MIN_TTL_SECONDS);
}
