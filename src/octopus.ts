import type { Rate } from "./types";

export const API_BASE = "https://api.octopus.energy/v1";
export const AGILE_PRODUCT = "AGILE-24-10-01";
export const FLEXIBLE_PRODUCT = "VAR-22-11-01";
export const REFERENCE_LABEL = "Flexible Octopus";
export const REFERENCE_SHORT = "Flexible";

const USER_AGENT = "trmnl-octopus (+https://github.com/MattieTK/trmnl-octopus)";
const TIMEOUT_MS = 10_000;
const AGILE_LOOKAHEAD_MS = 48 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

export type Fetcher = typeof fetch;

export function unitRatesUrl(product: string, region: string, from: Date, to: Date, pageSize: number): string {
  const tariff = `E-1R-${product}-${region}`;
  const url = new URL(`${API_BASE}/products/${product}/electricity-tariffs/${tariff}/standard-unit-rates/`);
  url.searchParams.set("period_from", from.toISOString());
  url.searchParams.set("period_to", to.toISOString());
  url.searchParams.set("page_size", String(pageSize));
  return url.toString();
}

async function getRates(url: string, fetcher: Fetcher): Promise<Rate[]> {
  const response = await fetcher(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Octopus API returned ${response.status} for ${url}`);
  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) throw new Error(`Octopus API returned no results array for ${url}`);
  return body.results as Rate[];
}

/** Agile rates for 48 hours from `from`, oldest first. At most 96 rows, so one page. */
export async function fetchAgileRates(region: string, from: Date, fetcher: Fetcher = fetch): Promise<Rate[]> {
  const to = new Date(from.getTime() + AGILE_LOOKAHEAD_MS);
  const rates = await getRates(unitRatesUrl(AGILE_PRODUCT, region, from, to, 100), fetcher);
  return [...rates].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}

/** Flexible Octopus direct debit unit rate in force at `at`, or null if absent. */
export async function fetchFlexibleRate(region: string, at: Date, fetcher: Fetcher = fetch): Promise<number | null> {
  const to = new Date(at.getTime() + HALF_HOUR_MS);
  const rates = await getRates(unitRatesUrl(FLEXIBLE_PRODUCT, region, at, to, 10), fetcher);
  const row = rates.find((rate) => rate.payment_method === "DIRECT_DEBIT") ?? rates[0];
  return row && typeof row.value_inc_vat === "number" ? row.value_inc_vat : null;
}
