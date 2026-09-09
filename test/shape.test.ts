import { describe, expect, it } from "vitest";
import {
  bandFor,
  barGeometry,
  chartAxis,
  cheapestWindow,
  NoCurrentSlotError,
  round1,
  selectSlots,
  ticksFor,
  tomorrowIndex,
  tomorrowPending,
  vsReferencePct,
  windowUntil,
} from "../src/shape";
import { agileRows, EVENING, MORNING, REFERENCE, TODAY_END, TOMORROW_END } from "./helpers";

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
