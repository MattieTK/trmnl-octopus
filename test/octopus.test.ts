import { describe, expect, it } from "vitest";
import { fetchAgileRates, fetchFlexibleRate, unitRatesUrl } from "../src/octopus";
import { agileBody, flexibleBody, MORNING, stubFetch, TODAY_END } from "./helpers";

describe("unitRatesUrl", () => {
  it("builds the tariff URL with a UTC window", () => {
    const url = unitRatesUrl("AGILE-24-10-01", "C", new Date("2026-09-08T08:00:00Z"), new Date("2026-09-10T08:00:00Z"), 100);
    expect(url).toBe(
      "https://api.octopus.energy/v1/products/AGILE-24-10-01/electricity-tariffs/E-1R-AGILE-24-10-01-C/standard-unit-rates/?period_from=2026-09-08T08%3A00%3A00.000Z&period_to=2026-09-10T08%3A00%3A00.000Z&page_size=100",
    );
  });
});

describe("fetchAgileRates", () => {
  it("requests 48 hours from the slot start and sorts oldest first", async () => {
    const stub = stubFetch([{ match: "AGILE-24-10-01-C", body: agileBody(TODAY_END) }]);
    const rates = await fetchAgileRates("C", new Date("2026-09-08T08:00:00Z"), stub.fetcher);
    expect(stub.calls[0]).toContain("period_from=2026-09-08T08%3A00%3A00.000Z");
    expect(stub.calls[0]).toContain("period_to=2026-09-10T08%3A00%3A00.000Z");
    expect(stub.calls[0]).toContain("page_size=100");
    expect(rates[0].valid_from < rates[rates.length - 1].valid_from).toBe(true);
    expect(rates).toHaveLength(agileBody(TODAY_END).results.length);
    stub.assertAllUsed();
  });

  it("throws on a non-2xx response", async () => {
    const stub = stubFetch([{ match: "AGILE-24-10-01-C", status: 503, body: "down" }]);
    await expect(fetchAgileRates("C", MORNING, stub.fetcher)).rejects.toThrow("503");
  });

  it("throws when results is missing", async () => {
    const stub = stubFetch([{ match: "AGILE-24-10-01-C", body: { detail: "nope" } }]);
    await expect(fetchAgileRates("C", MORNING, stub.fetcher)).rejects.toThrow("results");
  });

  it("sends an identifying user agent", async () => {
    let headers: Headers | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify(agileBody(TODAY_END)));
    };
    await fetchAgileRates("C", MORNING, fetcher);
    expect(headers?.get("user-agent")).toContain("trmnl-octopus");
    expect(headers?.get("accept")).toBe("application/json");
  });
});

describe("fetchFlexibleRate", () => {
  it("returns the direct debit rate", async () => {
    const stub = stubFetch([{ match: "VAR-22-11-01-C", body: flexibleBody }]);
    expect(await fetchFlexibleRate("C", MORNING, stub.fetcher)).toBe(26.347335);
    expect(stub.calls[0]).toContain("page_size=10");
  });

  it("returns null when no rows come back", async () => {
    const stub = stubFetch([{ match: "VAR-22-11-01-C", body: { results: [] } }]);
    expect(await fetchFlexibleRate("C", MORNING, stub.fetcher)).toBeNull();
  });
});
