import { describe, expect, it } from "vitest";
import { DEFAULT_DURATIONS, parseAt, parseDurations } from "../src/params";

describe("parseDurations", () => {
  it("defaults when absent or blank", () => {
    expect(parseDurations(undefined)).toEqual(DEFAULT_DURATIONS);
    expect(parseDurations("")).toEqual(DEFAULT_DURATIONS);
    expect(DEFAULT_DURATIONS).toEqual([2, 3]);
  });

  it("keeps the caller's order and duplicates", () => {
    expect(parseDurations("3,2")).toEqual([3, 2]);
    expect(parseDurations("2,2")).toEqual([2, 2]);
    expect(parseDurations(" 1.5 , 4 ")).toEqual([1.5, 4]);
  });

  it("rejects out-of-range, non-half-hour, too many and non-numeric values", () => {
    expect(parseDurations("0")).toBeNull();
    expect(parseDurations("12.5")).toBeNull();
    expect(parseDurations("1.25")).toBeNull();
    expect(parseDurations("1,2,3,4,5")).toBeNull();
    expect(parseDurations("two")).toBeNull();
    expect(parseDurations("2,")).toBeNull();
  });
});

describe("parseAt", () => {
  it("distinguishes absent, valid and invalid", () => {
    expect(parseAt(undefined)).toBeUndefined();
    expect(parseAt("2026-09-08T08:05:00Z")?.toISOString()).toBe("2026-09-08T08:05:00.000Z");
    expect(parseAt("yesterday")).toBeNull();
  });
});
