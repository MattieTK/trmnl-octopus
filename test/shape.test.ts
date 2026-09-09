import { describe, expect, it } from "vitest";
import {
  bandFor,
  barGeometry,
  chartAxis,
  cheapestWindow,
  NoCurrentSlotError,
  round1,
  selectSlots,
  shape,
  ticksFor,
  tomorrowIndex,
  tomorrowPending,
  vsReferencePct,
  windowUntil,
} from "../src/shape";
import { agileRows, EVENING, MORNING, REFERENCE, TODAY_END, TOMORROW_END, withNegative } from "./helpers";

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(22.323)).toBe(22.3);
    expect(round1(-0.34)).toBe(-0.3);
  });
});

describe("selectSlots", () => {
  it("returns the current slot and everything after it, oldest first", () => {
    const slots = selectSlots(agileRows(TODAY_END), MORNING);
    expect(slots).toHaveLength(28);
    expect(slots[0].valid_from).toBe("2026-09-08T08:00:00Z");
    expect(slots[27].valid_to).toBe("2026-09-08T22:00:00Z");
  });

  it("throws when nothing covers now", () => {
    expect(() => selectSlots(agileRows(TODAY_END), new Date("2026-09-09T05:00:00Z"))).toThrow(NoCurrentSlotError);
    expect(() => selectSlots([], MORNING)).toThrow(NoCurrentSlotError);
  });
});

describe("bandFor and vsReferencePct", () => {
  it("classifies against the reference", () => {
    expect(bandFor(-0.1, REFERENCE)).toBe("negative");
    expect(bandFor(0, REFERENCE)).toBe("negative");
    expect(bandFor(10, REFERENCE)).toBe("below");
    expect(bandFor(REFERENCE, REFERENCE)).toBe("above");
    expect(bandFor(40, REFERENCE)).toBe("above");
  });

  it("gives a signed integer percentage", () => {
    expect(vsReferencePct(22.323, REFERENCE)).toBe(-15);
    expect(vsReferencePct(46, REFERENCE)).toBe(75);
  });
});

describe("cheapestWindow", () => {
  it("finds the lowest-average contiguous run", () => {
    expect(cheapestWindow([5, 1, 1, 9, 2, 2, 2], 2)).toEqual({ start: 1, average: 1 });
    expect(cheapestWindow([5, 1, 1, 9, 2, 2, 2], 3)).toEqual({ start: 4, average: 2 });
  });

  it("prefers the earliest on ties", () => {
    expect(cheapestWindow([3, 3, 3, 3], 2)).toEqual({ start: 0, average: 3 });
  });

  it("returns null when too few prices", () => {
    expect(cheapestWindow([1, 2], 3)).toBeNull();
    expect(cheapestWindow([], 1)).toBeNull();
  });
});

describe("chartAxis", () => {
  it("rounds the top up to a multiple of ten and keeps room for the reference", () => {
    const axis = chartAxis([10, 46], REFERENCE);
    expect(axis.axis_max).toBe(50);
    expect(axis.axis_min).toBe(0);
    expect(axis.zero_y).toBe(100);
    expect(axis.reference_y).toBe(47.3);
  });

  it("raises the top when the reference is near the maximum", () => {
    expect(chartAxis([10, 26], REFERENCE).axis_max).toBe(40);
  });

  it("extends below zero for negative prices", () => {
    const axis = chartAxis([-1.5, 46], REFERENCE);
    expect(axis.axis_min).toBe(-5);
    expect(axis.zero_y).toBe(90.9);
  });
});

describe("barGeometry", () => {
  const axis = chartAxis([-1.5, 46], REFERENCE);

  it("draws positive bars up from zero", () => {
    expect(barGeometry(46, axis)).toEqual({ y: 7.3, h: 83.6 });
  });

  it("draws negative bars down from zero", () => {
    expect(barGeometry(-1.5, axis)).toEqual({ y: 90.9, h: 2.7 });
  });
});

const startsFor = (until: string, now: Date) => selectSlots(agileRows(until), now).map((r) => new Date(r.valid_from));

describe("ticksFor", () => {
  it("marks the first slot and every three-hour boundary", () => {
    expect(ticksFor(startsFor(TODAY_END, MORNING))).toEqual([
      { index: 0, label: "09:00" },
      { index: 6, label: "12:00" },
      { index: 12, label: "15:00" },
      { index: 18, label: "18:00" },
      { index: 24, label: "21:00" },
    ]);
  });

  it("drops a boundary tick that would collide with the first label", () => {
    const ticks = ticksFor(startsFor(TOMORROW_END, EVENING));
    expect(ticks.slice(0, 4)).toEqual([
      { index: 0, label: "17:30" },
      { index: 7, label: "21:00" },
      { index: 13, label: "00:00" },
      { index: 19, label: "03:00" },
    ]);
  });
});

describe("tomorrowIndex", () => {
  it("is null when the window stays within today", () => {
    expect(tomorrowIndex(startsFor(TODAY_END, MORNING), MORNING)).toBeNull();
  });

  it("points at the first slot on tomorrow's London date", () => {
    expect(tomorrowIndex(startsFor(TOMORROW_END, EVENING), EVENING)).toBe(13);
  });
});

describe("windowUntil and tomorrowPending", () => {
  it("describes the end of the window", () => {
    expect(windowUntil(new Date("2026-09-08T22:00:00Z"), MORNING)).toBe("23:00 today");
    expect(windowUntil(new Date("2026-09-09T22:00:00Z"), EVENING)).toBe("23:00 tomorrow");
  });

  it("flags a missing tomorrow only after 16:00 London time", () => {
    expect(tomorrowPending(new Date("2026-09-08T22:00:00Z"), MORNING)).toBe(false);
    expect(tomorrowPending(new Date("2026-09-08T22:00:00Z"), EVENING)).toBe(true);
    expect(tomorrowPending(new Date("2026-09-09T22:00:00Z"), EVENING)).toBe(false);
    expect(tomorrowPending(new Date("2026-09-09T22:00:00Z"), new Date("2026-09-08T22:30:00Z"))).toBe(false);
  });
});

const reference = { price: REFERENCE, label: "Flexible Octopus", short: "Flexible" };

describe("shape – morning", () => {
  const payload = shape({ region: "C", agile: agileRows(TODAY_END), reference, durations: [2, 3], now: MORNING });

  it("describes region, reference and the current slot", () => {
    expect(payload.ok).toBe(true);
    expect(payload.stale).toBe(false);
    expect(payload.region).toEqual({ code: "C", name: "London" });
    expect(payload.reference).toEqual({ price: 26.3, label: "Flexible Octopus", short: "Flexible" });
    expect(payload.now).toEqual({ time: "09:00", end: "09:30", price: 22.3, vs_reference_pct: -15, band: "below" });
    expect(payload.next).toEqual({ time: "09:30", end: "10:00", price: 21.7, vs_reference_pct: -18, band: "below", delta: -0.6 });
    expect(payload.slot_label).toBe("09:00");
  });

  it("covers the rest of today", () => {
    expect(payload.window).toEqual({ until: "23:00 today", includes_tomorrow: false, tomorrow_pending: false, slot_count: 28 });
    expect(payload.slots).toHaveLength(28);
    expect(payload.slots[0]).toMatchObject({ time: "09:00", price: 22.3, band: "below" });
  });

  it("summarises the window", () => {
    expect(payload.stats).toEqual({
      min: { time: "14:30", day: "Today", price: 6.7 },
      max: { time: "18:30", day: "Today", price: 46 },
      average: 23.8,
      below_reference_pct: 54,
      negative_count: 0,
    });
  });

  it("lays out the chart", () => {
    expect(payload.chart.axis_max).toBe(50);
    expect(payload.chart.axis_min).toBe(0);
    expect(payload.chart.reference_y).toBe(47.3);
    expect(payload.chart.zero_y).toBe(100);
    expect(payload.chart.ticks[1]).toEqual({ index: 6, label: "12:00" });
    expect(payload.chart.tomorrow_index).toBeNull();
    expect(payload.chart.tomorrow_label).toBeNull();
  });

  it("finds the cheapest windows in the requested order", () => {
    expect(payload.windows).toEqual([
      { hours: 2, available: true, day: "Today", start: "13:30", end: "15:30", average: 7.5, vs_reference_pct: -72, start_index: 9, slot_count: 4 },
      { hours: 3, available: true, day: "Today", start: "13:00", end: "16:00", average: 8.1, vs_reference_pct: -69, start_index: 8, slot_count: 6 },
    ]);
  });

  it("stays small", () => {
    expect(JSON.stringify(payload).length).toBeLessThan(20_000);
  });
});

describe("shape – evening with tomorrow", () => {
  const payload = shape({ region: "C", agile: agileRows(TOMORROW_END), reference, durations: [2, 3], now: EVENING });

  it("extends into tomorrow", () => {
    expect(payload.window).toEqual({ until: "23:00 tomorrow", includes_tomorrow: true, tomorrow_pending: false, slot_count: 59 });
    expect(payload.chart.tomorrow_index).toBe(13);
    expect(payload.chart.tomorrow_label).toBe("Wed");
    expect(payload.chart.axis_max).toBe(60);
  });

  it("labels windows that start tomorrow", () => {
    expect(payload.windows[0]).toMatchObject({ hours: 2, available: true, day: "Tomorrow", start: "03:00", end: "05:00", average: 21.8, start_index: 19 });
    expect(payload.windows[1]).toMatchObject({ hours: 3, day: "Tomorrow", start: "02:00", end: "05:00", start_index: 17 });
  });

  it("stays small with the longest window", () => {
    expect(JSON.stringify(payload).length).toBeLessThan(20_000);
  });
});

describe("shape – evening before publication", () => {
  const payload = shape({ region: "C", agile: agileRows(TODAY_END), reference, durations: [2, 12], now: EVENING });

  it("flags that tomorrow is pending", () => {
    expect(payload.window).toEqual({ until: "23:00 today", includes_tomorrow: false, tomorrow_pending: true, slot_count: 11 });
  });

  it("reports a window that no longer fits", () => {
    expect(payload.windows[0]).toMatchObject({ hours: 2, available: true, start: "21:00", end: "23:00", average: 28.3, vs_reference_pct: 8 });
    expect(payload.windows[1]).toEqual({ hours: 12, available: false });
  });
});

describe("shape – negative prices", () => {
  const payload = shape({ region: "C", agile: withNegative(agileRows(TODAY_END)), reference, durations: [2], now: MORNING });

  it("counts and bands negative slots and extends the axis", () => {
    expect(payload.stats.negative_count).toBe(2);
    expect(payload.stats.min).toEqual({ time: "13:00", day: "Today", price: -1.5 });
    expect(payload.chart.axis_min).toBe(-5);
    expect(payload.chart.zero_y).toBe(90.9);
    expect(payload.slots[8]).toEqual({ time: "13:00", price: -1.5, band: "negative", y: 90.9, h: 2.7 });
  });

  it("pulls the cheapest window over the negative slots", () => {
    const window = payload.windows[0];
    expect(window.available).toBe(true);
    if (window.available) {
      expect(window.start_index).toBeLessThanOrEqual(8);
      expect(window.start_index + window.slot_count).toBeGreaterThan(8);
    }
  });
});

describe("shape – last slot", () => {
  it("has no next when the current slot is the final one", () => {
    const rows = agileRows(TODAY_END);
    const payload = shape({ region: "C", agile: rows, reference, durations: [2], now: new Date("2026-09-08T21:45:00Z") });
    expect(payload.next).toBeNull();
    expect(payload.windows[0]).toEqual({ hours: 2, available: false });
  });
});
