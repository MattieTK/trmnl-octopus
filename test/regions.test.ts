import { describe, expect, it } from "vitest";
import { FALLBACK_REFERENCE, parseRegion, REGION_CODES, REGIONS } from "../src/regions";

describe("regions", () => {
  it("lists the fourteen DNO regions without I or O", () => {
    expect(REGION_CODES).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P"]);
    expect(REGIONS.C).toBe("London");
  });

  it("has a fallback reference price for every region", () => {
    for (const code of REGION_CODES) {
      expect(FALLBACK_REFERENCE[code]).toBeGreaterThan(20);
    }
  });

  it("parses letters case-insensitively and rejects others", () => {
    expect(parseRegion("c")).toBe("C");
    expect(parseRegion(" P ")).toBe("P");
    expect(parseRegion("I")).toBeNull();
    expect(parseRegion("CC")).toBeNull();
    expect(parseRegion(undefined)).toBeNull();
    expect(parseRegion("")).toBeNull();
  });
});
