import { Hono } from "hono";
import { lastGoodKey, LAST_GOOD_TTL_SECONDS, periodKey, ttlSeconds } from "./cache";
import { homepage } from "./homepage";
import { fetchAgileRates, fetchFlexibleRate, REFERENCE_LABEL, REFERENCE_SHORT, type Fetcher } from "./octopus";
import { parseAt, parseDurations } from "./params";
import { FALLBACK_REFERENCE, parseRegion, REGION_CODES } from "./regions";
import { shape } from "./shape";
import { slotStart } from "./time";
import type { ErrorPayload, Payload } from "./types";

export type AppOptions = {
  /** Clock override for tests. Defaults to the real time. */
  now?: () => Date;
  /** fetch override for tests. Defaults to the global fetch. */
  fetcher?: Fetcher;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

function errorBody(error: string, setup = false): ErrorPayload {
  return { ok: false, setup, error };
}

const NO_STORE = { "Cache-Control": "no-store" };

export function createApp(options: AppOptions = {}) {
  const clock = options.now ?? (() => new Date());
  const fetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const app = new Hono();

  app.get("/", (c) => c.html(homepage));

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/trmnl", async (c) => {
    // Configuration problems answer 200: TRMNL marks a polling plugin as
    // degraded on any non-2xx response, and a freshly installed plugin polls
    // before the user has chosen a region.
    const region = parseRegion(c.req.query("region"));
    if (!region) {
      return c.json(
        errorBody(`Choose your electricity region in the plugin settings (one of ${REGION_CODES.join(", ")})`, true),
        200,
        NO_STORE,
      );
    }
    const durations = parseDurations(c.req.query("durations"));
    if (!durations) {
      return c.json(
        errorBody("Appliance run times must be between 0.5 and 12 hours in half-hour steps", true),
        200,
        NO_STORE,
      );
    }
    const at = parseAt(c.req.query("at"));
    if (at === null) {
      return c.json(errorBody("at must be an ISO 8601 timestamp"), 400);
    }

    const now = at ?? clock();
    const useCache = at === undefined;
    const cache = caches.default;

    if (useCache) {
      const hit = await cache.match(periodKey(region, durations, now));
      if (hit) return hit;
    }

    let payload: Payload;
    try {
      const [agile, flexible] = await Promise.all([
        fetchAgileRates(region, slotStart(now), fetcher),
        fetchFlexibleRate(region, now, fetcher).catch((error: unknown) => {
          console.error("Flexible rate fetch failed", { region, error: String(error) });
          return null;
        }),
      ]);
      const reference =
        flexible !== null
          ? { price: flexible, label: REFERENCE_LABEL, short: REFERENCE_SHORT }
          : { price: FALLBACK_REFERENCE[region], label: "Typical variable", short: "typical" };
      payload = shape({ region, agile, reference, durations, now });
    } catch (error) {
      console.error("Agile fetch or shaping failed", {
        region,
        durations,
        now: now.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      const lastGood = await cache.match(lastGoodKey(region, durations));
      if (lastGood) {
        const stale: Payload = { ...((await lastGood.json()) as Payload), stale: true };
        return c.json(stale, 200, NO_STORE);
      }
      return c.json(errorBody("Octopus Energy prices are unavailable at the moment"), 502, NO_STORE);
    }

    const ttl = ttlSeconds(now, payload.window.tomorrow_pending);
    const response = c.json(payload, 200, { "Cache-Control": `public, max-age=${ttl}` });

    if (useCache) {
      const lastGoodResponse = new Response(JSON.stringify(payload), {
        headers: { ...JSON_HEADERS, "Cache-Control": `public, max-age=${LAST_GOOD_TTL_SECONDS}` },
      });
      c.executionCtx.waitUntil(
        Promise.all([
          cache.put(periodKey(region, durations, now), response.clone()),
          cache.put(lastGoodKey(region, durations), lastGoodResponse),
        ]),
      );
    }
    return response;
  });

  return app;
}

export default createApp();
