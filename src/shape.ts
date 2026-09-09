import type { Band, Rate } from "./types";

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
