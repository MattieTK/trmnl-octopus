/** DNO region letter to area name. Octopus skips I and O. */
export const REGIONS: Record<string, string> = {
  A: "Eastern England",
  B: "East Midlands",
  C: "London",
  D: "Merseyside and North Wales",
  E: "West Midlands",
  F: "North East England",
  G: "North West England",
  H: "Southern England",
  J: "South East England",
  K: "South Wales",
  L: "South West England",
  M: "Yorkshire",
  N: "Southern Scotland",
  P: "Northern Scotland",
};

export const REGION_CODES = Object.keys(REGIONS);

/**
 * Flexible Octopus direct debit unit rates, p/kWh inc VAT, 1 July to 30
 * September 2026. Used only when the live Flexible fetch fails. Update each
 * quarter from https://api.octopus.energy/v1/products/VAR-22-11-01/.
 */
export const FALLBACK_REFERENCE: Record<string, number> = {
  A: 26.38,
  B: 25.1,
  C: 26.35,
  D: 27.66,
  E: 25.33,
  F: 25.22,
  G: 26.13,
  H: 26.42,
  J: 26.67,
  K: 26.33,
  L: 26.39,
  M: 25.3,
  N: 25.85,
  P: 26.42,
};

export function parseRegion(raw: string | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return code.length === 1 && code in REGIONS ? code : null;
}
