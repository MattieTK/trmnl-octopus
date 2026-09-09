import { describe, expect, it } from "vitest";
import {
  dayLabel,
  londonDate,
  londonHour,
  londonMinute,
  londonTime,
  londonWeekday,
  nextSlotStart,
  slotStart,
} from "../src/time";

describe("slot boundaries", () => {
  it("floors to the half hour", () => {
    expect(slotStart(new Date("2026-09-08T08:05:00Z")).toISOString()).toBe("2026-09-08T08:00:00.000Z");
    expect(slotStart(new Date("2026-09-08T08:35:59Z")).toISOString()).toBe("2026-09-08T08:30:00.000Z");
  });

  it("finds the next boundary", () => {
    expect(nextSlotStart(new Date("2026-09-08T08:05:00Z")).toISOString()).toBe("2026-09-08T08:30:00.000Z");
    expect(nextSlotStart(new Date("2026-09-08T08:30:00Z")).toISOString()).toBe("2026-09-08T09:00:00.000Z");
  });
});

describe("London formatting", () => {
  it("formats BST times", () => {
    expect(londonTime(new Date("2026-09-08T08:00:00Z"))).toBe("09:00");
    expect(londonTime(new Date("2026-09-08T23:30:00Z"))).toBe("00:30");
  });

  it("formats GMT times", () => {
    expect(londonTime(new Date("2026-12-08T08:00:00Z"))).toBe("08:00");
  });

  it("formats dates in London", () => {
    expect(londonDate(new Date("2026-09-08T23:30:00Z"))).toBe("2026-09-09");
    expect(londonDate(new Date("2026-09-08T22:30:00Z"))).toBe("2026-09-08");
  });

  it("exposes hour, minute and weekday", () => {
    const d = new Date("2026-09-08T16:35:00Z");
    expect(londonHour(d)).toBe(17);
    expect(londonMinute(d)).toBe(35);
    expect(londonWeekday(d)).toBe("Tue");
  });
});

describe("dayLabel", () => {
  const now = new Date("2026-09-08T16:35:00Z");

  it("labels today and tomorrow by London date", () => {
    expect(dayLabel(new Date("2026-09-08T21:00:00Z"), now)).toBe("Today");
    expect(dayLabel(new Date("2026-09-08T23:00:00Z"), now)).toBe("Tomorrow");
  });

  it("falls back to the weekday further out", () => {
    expect(dayLabel(new Date("2026-09-10T10:00:00Z"), now)).toBe("Thu");
  });
});
