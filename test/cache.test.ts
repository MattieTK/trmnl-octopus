import { describe, expect, it } from "vitest";
import { lastGoodKey, periodKey, ttlSeconds } from "../src/cache";

describe("cache keys", () => {
  it("changes the period key every half hour and keeps duration order", () => {
    const a = periodKey("C", [2, 3], new Date("2026-09-08T08:05:00Z")).url;
    const b = periodKey("C", [2, 3], new Date("2026-09-08T08:25:00Z")).url;
    const c = periodKey("C", [2, 3], new Date("2026-09-08T08:35:00Z")).url;
    const d = periodKey("C", [3, 2], new Date("2026-09-08T08:05:00Z")).url;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toContain("region=C");
    expect(a).toContain("durations=2,3");
  });

  it("uses a period-free last-good key", () => {
    const key = lastGoodKey("C", [2, 3]).url;
    expect(key).not.toContain("period=");
    expect(key).toContain("region=C");
  });
});

describe("ttlSeconds", () => {
  it("runs to the next half-hour boundary", () => {
    expect(ttlSeconds(new Date("2026-09-08T08:05:00Z"), false)).toBe(1500);
  });

  it("caps at five minutes while tomorrow is pending", () => {
    expect(ttlSeconds(new Date("2026-09-08T16:05:00Z"), true)).toBe(300);
    expect(ttlSeconds(new Date("2026-09-08T16:28:00Z"), true)).toBe(120);
  });

  it("never drops below thirty seconds", () => {
    expect(ttlSeconds(new Date("2026-09-08T08:29:50Z"), false)).toBe(30);
  });
});
