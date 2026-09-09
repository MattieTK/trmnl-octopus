import { describe, expect, it } from "vitest";
import {
  bandFor,
  cheapestWindow,
  NoCurrentSlotError,
  round1,
  selectSlots,
  vsReferencePct,
} from "../src/shape";
import { agileRows, MORNING, REFERENCE, TODAY_END } from "./helpers";

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
