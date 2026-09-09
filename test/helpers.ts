import raw from "./fixtures/agile-c-raw.json";
import flexible from "./fixtures/flexible-c.json";
import type { Rate } from "../src/types";

/** Flexible Octopus, region C, direct debit, Jul–Sep 2026, inc VAT. */
export const REFERENCE = 26.347335;

export const MORNING = new Date("2026-09-08T08:05:00Z");
export const EVENING = new Date("2026-09-08T16:35:00Z");
export const TODAY_END = "2026-09-08T22:00:00Z";
export const TOMORROW_END = "2026-09-09T22:00:00Z";

/** Rows ending at or before `until`, in the API's newest-first order. */
export function agileRows(until: string): Rate[] {
  return (raw.results as Rate[]).filter((row) => row.valid_to <= until);
}

export function agileBody(until: string) {
  return { count: 0, next: null, previous: null, results: agileRows(until) };
}

export const flexibleBody = flexible;

/** Morning rows with 13:00 and 13:30 BST turned negative. */
export function withNegative(rows: Rate[]): Rate[] {
  return rows.map((row) => {
    if (row.valid_from === "2026-09-08T12:00:00Z") return { ...row, value_inc_vat: -1.5 };
    if (row.valid_from === "2026-09-08T12:30:00Z") return { ...row, value_inc_vat: -0.3 };
    return row;
  });
}

export type Route = {
  /** Substring the request URL must contain. */
  match: string;
  status?: number;
  body: unknown;
  /** How many times the route may be hit. Defaults to 1. */
  times?: number;
};

/**
 * A stand-in for fetch that answers by URL substring. Each route is consumed
 * `times` times; an unmatched request throws so a test cannot silently reach
 * the real network.
 */
export function stubFetch(routes: Route[]) {
  const remaining = routes.map((route) => route.times ?? 1);
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const index = routes.findIndex((route, i) => remaining[i] > 0 && url.includes(route.match));
    if (index < 0) throw new Error(`Unexpected fetch: ${url}`);
    remaining[index] -= 1;
    const route = routes[index];
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return {
    fetcher,
    calls,
    assertAllUsed() {
      const unused = routes.filter((_, i) => remaining[i] > 0).map((route) => route.match);
      if (unused.length > 0) throw new Error(`Routes never called: ${unused.join(", ")}`);
    },
  };
}
