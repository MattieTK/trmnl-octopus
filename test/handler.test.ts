import { describe, expect, it } from "vitest";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { createApp } from "../src/index";
import type { Payload } from "../src/types";
import { agileBody, EVENING, flexibleBody, MORNING, stubFetch, TODAY_END, TOMORROW_END, type Route } from "./helpers";

const AGILE = "AGILE-24-10-01";
const FLEXIBLE = "VAR-22-11-01";

const okRoutes = (until: string): Route[] => [
  { match: AGILE, body: agileBody(until) },
  { match: FLEXIBLE, body: flexibleBody },
];

async function get(app: ReturnType<typeof createApp>, path: string) {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`http://localhost${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("GET /trmnl validation", () => {
  const app = createApp({ now: () => MORNING, fetcher: stubFetch([]).fetcher });

  it("answers a missing or empty region with a 200 setup payload so TRMNL is not degraded", async () => {
    for (const path of ["/trmnl", "/trmnl?region=", "/trmnl?region=%20"]) {
      const response = await get(app, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = (await response.json()) as { ok: boolean; setup: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.setup).toBe(true);
      expect(body.error).toContain("region");
    }
  });

  it("treats an unknown region and bad durations as setup problems", async () => {
    const unknown = await get(app, "/trmnl?region=I");
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toMatchObject({ ok: false, setup: true });
    const durations = await get(app, "/trmnl?region=C&durations=99");
    expect(durations.status).toBe(200);
    expect(await durations.json()).toMatchObject({ ok: false, setup: true });
  });

  it("still rejects a bad at parameter", async () => {
    const response = await get(app, "/trmnl?region=C&at=soon");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});

describe("GET /trmnl success", () => {
  it("returns a shaped payload with half-hour caching", async () => {
    const stub = stubFetch(okRoutes(TODAY_END));
    const app = createApp({ now: () => MORNING, fetcher: stub.fetcher });

    const response = await get(app, "/trmnl?region=c&durations=2,3");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=1500");
    const payload = (await response.json()) as Payload;
    expect(payload.ok).toBe(true);
    expect(payload.stale).toBe(false);
    expect(payload.region.code).toBe("C");
    expect(payload.reference.label).toBe("Flexible Octopus");
    expect(payload.windows).toHaveLength(2);
    stub.assertAllUsed();
  });

  it("serves the second request in the same period from cache", async () => {
    const stub = stubFetch(okRoutes(TODAY_END));
    const app = createApp({ now: () => new Date("2026-09-08T09:05:00Z"), fetcher: stub.fetcher });

    const first = (await (await get(app, "/trmnl?region=D")).json()) as Payload;
    const second = (await (await get(app, "/trmnl?region=D")).json()) as Payload;
    expect(second).toEqual(first);
    expect(second.stale).toBe(false);
    expect(stub.calls).toHaveLength(2);
  });

  it("shortens the TTL while tomorrow is pending", async () => {
    const stub = stubFetch(okRoutes(TODAY_END));
    const app = createApp({ now: () => EVENING, fetcher: stub.fetcher });

    const response = await get(app, "/trmnl?region=E");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    const payload = (await response.json()) as Payload;
    expect(payload.window.tomorrow_pending).toBe(true);
  });

  it("bypasses the cache and honours at", async () => {
    const stub = stubFetch([
      { match: AGILE, body: agileBody(TOMORROW_END), times: 2 },
      { match: FLEXIBLE, body: flexibleBody, times: 2 },
    ]);
    const app = createApp({ now: () => MORNING, fetcher: stub.fetcher });

    const path = `/trmnl?region=F&at=${EVENING.toISOString()}`;
    const payload = (await (await get(app, path)).json()) as Payload;
    expect(payload.now.time).toBe("17:30");
    expect(payload.window.includes_tomorrow).toBe(true);
    await get(app, path);
    expect(stub.calls).toHaveLength(4);
  });

  it("falls back to the typical reference when Flexible fails", async () => {
    const stub = stubFetch([
      { match: AGILE, body: agileBody(TODAY_END) },
      { match: FLEXIBLE, status: 500, body: "boom" },
    ]);
    const app = createApp({ now: () => MORNING, fetcher: stub.fetcher });

    const payload = (await (await get(app, "/trmnl?region=G")).json()) as Payload;
    expect(payload.reference.label).toBe("Typical variable");
    expect(payload.reference.short).toBe("typical");
  });
});

describe("GET /trmnl failures", () => {
  it("returns 502 when Agile fails and nothing is cached", async () => {
    const stub = stubFetch([
      { match: AGILE, status: 500, body: "boom" },
      { match: FLEXIBLE, body: flexibleBody },
    ]);
    const app = createApp({ now: () => MORNING, fetcher: stub.fetcher });

    const response = await get(app, "/trmnl?region=H");
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("serves the last good payload as stale when Agile fails later", async () => {
    const good = stubFetch(okRoutes(TODAY_END));
    const app = createApp({ now: () => new Date("2026-09-08T10:05:00Z"), fetcher: good.fetcher });
    const payload = (await (await get(app, "/trmnl?region=J")).json()) as Payload;

    const bad = stubFetch([
      { match: AGILE, status: 500, body: "boom" },
      { match: FLEXIBLE, body: flexibleBody },
    ]);
    const later = createApp({ now: () => new Date("2026-09-08T10:35:00Z"), fetcher: bad.fetcher });
    const response = await get(later, "/trmnl?region=J");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const stale = (await response.json()) as Payload;
    expect(stale.stale).toBe(true);
    expect(stale.slots).toEqual(payload.slots);
  });

  it("treats an empty Agile response as a failure", async () => {
    const stub = stubFetch([
      { match: AGILE, body: { results: [] } },
      { match: FLEXIBLE, body: flexibleBody },
    ]);
    const app = createApp({ now: () => MORNING, fetcher: stub.fetcher });
    expect((await get(app, "/trmnl?region=K")).status).toBe(502);
  });
});
