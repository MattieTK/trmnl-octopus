import { londonDate, londonHour, londonMinute, londonTime } from "./time";
import type { Band, Rate, Tick } from "./types";

export class NoCurrentSlotError extends Error {
  constructor() {
    super("No Agile price covers the current half hour");
    this.name = "NoCurrentSlotError";
  }
}

export const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Rates from the slot containing `now` to the last published slot, oldest first. */
export function selectSlots(rates: Rate[], now: Date): Rate[] {
  const t = now.getTime();
  const sorted = [...rates].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const index = sorted.findIndex((rate) => Date.parse(rate.valid_from) <= t && t < Date.parse(rate.valid_to));
  if (index < 0) throw new NoCurrentSlotError();
  return sorted.slice(index);
}

export function bandFor(price: number, reference: number): Band {
  if (price <= 0) return "negative";
  return price < reference ? "below" : "above";
}

export function vsReferencePct(price: number, reference: number): number {
  return Math.round(((price - reference) / reference) * 100);
}

/** Sliding-window minimum mean. Earliest start wins ties. */
export function cheapestWindow(prices: number[], size: number): { start: number; average: number } | null {
  if (size < 1 || prices.length < size) return null;
  let sum = 0;
  for (let i = 0; i < size; i++) sum += prices[i];
  let bestStart = 0;
  let bestSum = sum;
  for (let i = size; i < prices.length; i++) {
    sum += prices[i] - prices[i - size];
    if (sum < bestSum - 1e-9) {
      bestSum = sum;
      bestStart = i - size + 1;
    }
  }
  return { start: bestStart, average: bestSum / size };
}

export type Axis = {
  axis_max: number;
  axis_min: number;
  zero_y: number;
  reference_y: number;
  yFor: (price: number) => number;
};

/** Y axis in price units; y positions are percentages from the top. */
export function chartAxis(prices: number[], reference: number): Axis {
  const top = Math.max(...prices, reference + 5);
  const bottom = Math.min(...prices, 0);
  const axis_max = Math.ceil(top / 10) * 10;
  const axis_min = bottom < 0 ? Math.floor(bottom / 5) * 5 : 0;
  const span = axis_max - axis_min;
  const yFor = (price: number) => round1(((axis_max - price) / span) * 100);
  return { axis_max, axis_min, zero_y: yFor(0), reference_y: yFor(reference), yFor };
}

export function barGeometry(price: number, axis: Axis): { y: number; h: number } {
  if (price >= 0) {
    const y = axis.yFor(price);
    return { y, h: round1(axis.zero_y - y) };
  }
  return { y: axis.zero_y, h: round1(axis.yFor(price) - axis.zero_y) };
}

const TICK_HOURS = 3;
const TICK_CLEARANCE = 3;

/** The first slot plus every three-hour boundary, skipping boundaries too close to the first label. */
export function ticksFor(starts: Date[]): Tick[] {
  const ticks: Tick[] = [];
  starts.forEach((start, index) => {
    if (index === 0) {
      ticks.push({ index, label: londonTime(start) });
      return;
    }
    if (index < TICK_CLEARANCE) return;
    if (londonMinute(start) === 0 && londonHour(start) % TICK_HOURS === 0) {
      ticks.push({ index, label: londonTime(start) });
    }
  });
  return ticks;
}

export function tomorrowIndex(starts: Date[], now: Date): number | null {
  const today = londonDate(now);
  const index = starts.findIndex((start) => londonDate(start) !== today);
  return index < 0 ? null : index;
}

function endsToday(lastEnd: Date, now: Date): boolean {
  return londonDate(new Date(lastEnd.getTime() - 1)) === londonDate(now);
}

export function windowUntil(lastEnd: Date, now: Date): string {
  return `${londonTime(lastEnd)} ${endsToday(lastEnd, now) ? "today" : "tomorrow"}`;
}

const PUBLICATION_HOUR = 16;

export function tomorrowPending(lastEnd: Date, now: Date): boolean {
  return londonHour(now) >= PUBLICATION_HOUR && endsToday(lastEnd, now);
}
