import { REGIONS } from "./regions";
import { dayLabel, londonDate, londonHour, londonMinute, londonTime, londonWeekday } from "./time";
import type { Band, CheapestWindow, Extreme, Payload, PricePoint, Rate, Slot, Tick } from "./types";

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

export type ShapeInput = {
  region: string;
  agile: Rate[];
  reference: { price: number; label: string; short: string };
  durations: number[];
  now: Date;
};

function pricePoint(rate: Rate, reference: number): PricePoint {
  return {
    time: londonTime(new Date(rate.valid_from)),
    end: londonTime(new Date(rate.valid_to)),
    price: round1(rate.value_inc_vat),
    vs_reference_pct: vsReferencePct(rate.value_inc_vat, reference),
    band: bandFor(rate.value_inc_vat, reference),
  };
}

function extreme(rates: Rate[], index: number, now: Date): Extreme {
  const start = new Date(rates[index].valid_from);
  return { time: londonTime(start), day: dayLabel(start, now), price: round1(rates[index].value_inc_vat) };
}

function windowsFor(rates: Rate[], prices: number[], durations: number[], reference: number, now: Date): CheapestWindow[] {
  return durations.map((hours) => {
    const size = Math.round(hours * 2);
    const found = cheapestWindow(prices, size);
    if (!found) return { hours, available: false };
    const start = new Date(rates[found.start].valid_from);
    const end = new Date(rates[found.start + size - 1].valid_to);
    return {
      hours,
      available: true,
      day: dayLabel(start, now),
      start: londonTime(start),
      end: londonTime(end),
      average: round1(found.average),
      vs_reference_pct: vsReferencePct(found.average, reference),
      start_index: found.start,
      slot_count: size,
    };
  });
}

/** Builds the polling payload. Throws NoCurrentSlotError when `agile` does not cover `now`. */
export function shape(input: ShapeInput): Payload {
  const { now, durations } = input;
  const reference = input.reference.price;
  const rates = selectSlots(input.agile, now);
  const starts = rates.map((rate) => new Date(rate.valid_from));
  const prices = rates.map((rate) => rate.value_inc_vat);
  const axis = chartAxis(prices, reference);
  const lastEnd = new Date(rates[rates.length - 1].valid_to);
  const current = pricePoint(rates[0], reference);
  const nextRate = rates[1];
  const minIndex = prices.indexOf(Math.min(...prices));
  const maxIndex = prices.indexOf(Math.max(...prices));
  const tomorrowAt = tomorrowIndex(starts, now);

  const slots: Slot[] = rates.map((rate, index) => ({
    time: londonTime(starts[index]),
    price: round1(rate.value_inc_vat),
    band: bandFor(rate.value_inc_vat, reference),
    ...barGeometry(rate.value_inc_vat, axis),
  }));

  return {
    ok: true,
    stale: false,
    region: { code: input.region, name: REGIONS[input.region] ?? input.region },
    reference: { price: round1(reference), label: input.reference.label, short: input.reference.short },
    now: current,
    next: nextRate
      ? { ...pricePoint(nextRate, reference), delta: round1(nextRate.value_inc_vat - rates[0].value_inc_vat) }
      : null,
    window: {
      until: windowUntil(lastEnd, now),
      includes_tomorrow: tomorrowAt !== null,
      tomorrow_pending: tomorrowPending(lastEnd, now),
      slot_count: rates.length,
    },
    stats: {
      min: extreme(rates, minIndex, now),
      max: extreme(rates, maxIndex, now),
      average: round1(prices.reduce((sum, price) => sum + price, 0) / prices.length),
      below_reference_pct: Math.round((prices.filter((price) => price < reference).length / prices.length) * 100),
      negative_count: prices.filter((price) => price <= 0).length,
    },
    chart: {
      axis_max: axis.axis_max,
      axis_min: axis.axis_min,
      reference_y: axis.reference_y,
      zero_y: axis.zero_y,
      ticks: ticksFor(starts),
      tomorrow_index: tomorrowAt,
      tomorrow_label: tomorrowAt === null ? null : londonWeekday(starts[tomorrowAt]),
    },
    slots,
    windows: windowsFor(rates, prices, durations, reference, now),
    slot_label: current.time,
  };
}
