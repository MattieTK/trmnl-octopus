# TRMNL Octopus Agile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker that serves shaped Octopus Agile price data, and a TRMNL polling plugin that renders it as a glanceable chart with headline numbers and cheapest appliance windows.

**Architecture:** The Worker (Hono, TypeScript) fetches Agile and Flexible Octopus unit rates for a region, shapes them into a compact JSON payload with pure functions, and caches per region until the next half-hour. The TRMNL plugin polls that JSON every 15 minutes and renders it with Liquid, drawing the chart as inline SVG so no JavaScript runs at screenshot time.

**Tech Stack:** pnpm, Hono 4, TypeScript 5, Wrangler 4, Vitest 4 with `@cloudflare/vitest-pool-workers`, TRMNL Framework 3.3 Liquid templates, trmnlp (Docker image) for previews.

**Spec:** `docs/notes/2026-09-09-design.md`

## Global Constraints

- Package manager is pnpm. Use `pnpm add`, never npm or yarn.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`). No attribution lines in commit messages.
- British English in prose, comments and user-facing copy.
- No Octopus Energy logo or branding in the plugin. Footer copy is "Data: Octopus Energy public API · Not an Octopus product".
- Agile product `AGILE-24-10-01`; Flexible product `VAR-22-11-01`; regions A–H, J–N, P.
- Prices use `value_inc_vat` for both tariffs. Display prices rounded to one decimal place.
- Local times are Europe/London, 24-hour `HH:MM`.
- Polling payload must stay under 100 KB (target under 20 KB).
- `refresh_interval` in the plugin is 15.
- Every task ends with `pnpm test` passing (and `pnpm typecheck` from Task 2 onward) before commit.

---

## File structure

| Path | Responsibility |
|---|---|
| `package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts` | Project scaffold |
| `src/types.ts` | Shared TypeScript types for rates and the payload |
| `src/time.ts` | Half-hour slot maths and Europe/London formatting |
| `src/regions.ts` | Region letters, names, fallback reference prices, region parsing |
| `src/params.ts` | Parsing of `durations` and `at` query parameters |
| `src/octopus.ts` | HTTP calls to the Octopus API (the only file that touches the network) |
| `src/shape.ts` | Pure functions turning rates into the payload |
| `src/cache.ts` | Cache keys and TTL rule |
| `src/homepage.ts` | Static HTML for `/` |
| `src/index.ts` | Hono app factory, routes, orchestration and fallbacks |
| `test/helpers.ts` | Fixture loading and time anchors shared by tests |
| `test/fixtures/*.json` | Recorded Octopus responses |
| `test/*.test.ts` | One test file per source module plus the handler |
| `plugin/src/settings.yml` | TRMNL plugin definition and form fields |
| `plugin/src/full.liquid` | The screen |
| `plugin/.trmnlp.yml` | Local preview configuration |
| `README.md` | Setup, deploy and plugin install notes |

Fixture time anchors used throughout the tests (all UTC, BST is UTC+1 on these dates):

| Name | `now` | Rows included | Meaning |
|---|---|---|---|
| Morning | `2026-09-08T08:05:00Z` | up to `2026-09-08T22:00:00Z` | 09:05 Tuesday, today only, 28 slots |
| Evening | `2026-09-08T16:35:00Z` | up to `2026-09-09T22:00:00Z` | 17:35 Tuesday, today and tomorrow, 59 slots |
| Pending | `2026-09-08T16:35:00Z` | up to `2026-09-08T22:00:00Z` | 17:35 but tomorrow not published, 11 slots |

The Flexible reference for region C in the fixture is 26.347335 p/kWh.

---

### Task 1: Project scaffold and health route

**Files:**
- Create: `package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `test/health.test.ts`
- Existing: `.gitignore`, `test/fixtures/agile-c-raw.json`, `test/fixtures/flexible-c.json` (already recorded)

**Interfaces:**
- Produces: `createApp(options?: AppOptions): Hono` and a default export of `createApp()` from `src/index.ts`. Later tasks extend the same factory.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "trmnl-octopus",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add hono
pnpm add -D wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers vitest@^4.1 typescript@^5.9
```

Expected: `node_modules/` created, `pnpm-lock.yaml` written. Vitest must resolve to 4.x because the Workers pool declares `vitest: ^4.1.0` as a peer.

- [ ] **Step 3: Write wrangler.jsonc**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "trmnl-octopus",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  }
}
```

- [ ] **Step 4: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

- [ ] **Step 5: Write vitest.config.ts**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

- [ ] **Step 6: Write the failing health test**

`test/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { createApp } from "../src/index";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = createApp();
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request("http://localhost/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL, cannot resolve `../src/index`.

- [ ] **Step 8: Write the minimal app**

`src/index.ts`:

```ts
import { Hono } from "hono";

export type AppOptions = {
  /** Clock override for tests. Defaults to the real time. */
  now?: () => Date;
  /** fetch override for tests. Defaults to the global fetch. */
  fetcher?: typeof fetch;
};

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  return app;
}

export default createApp();
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test`
Expected: PASS (1 test). If Vitest complains about an unused `options` parameter, that is a lint warning only; TypeScript strict does not flag unused parameters.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml wrangler.jsonc tsconfig.json vitest.config.ts src/index.ts test/health.test.ts test/fixtures
git commit -m "chore: scaffold Worker with Hono, Wrangler and Vitest Workers pool"
```

---

### Task 2: Types and time helpers

**Files:**
- Create: `src/types.ts`, `src/time.ts`, `test/time.test.ts`

**Interfaces:**
- Produces from `src/types.ts`: `Rate`, `Band`, `PricePoint`, `Slot`, `Tick`, `CheapestWindow`, `Payload`, `ErrorPayload`.
- Produces from `src/time.ts`: `slotStart(date)`, `nextSlotStart(date)`, `londonTime(date)`, `londonDate(date)`, `londonHour(date)`, `londonMinute(date)`, `londonWeekday(date)`, `dayLabel(date, now)`.

- [ ] **Step 1: Write the types**

`src/types.ts`:

```ts
/** One half-hour row as returned by the Octopus unit-rates endpoint. */
export type Rate = {
  value_exc_vat: number;
  value_inc_vat: number;
  valid_from: string;
  valid_to: string;
  payment_method: string | null;
};

/** How a price compares with the reference tariff. */
export type Band = "negative" | "below" | "above";

export type PricePoint = {
  time: string;
  end: string;
  price: number;
  vs_reference_pct: number;
  band: Band;
};

export type Slot = {
  time: string;
  price: number;
  band: Band;
  /** Top of the bar as a percentage of chart height. */
  y: number;
  /** Bar height as a percentage of chart height. */
  h: number;
};

export type Tick = { index: number; label: string };

export type CheapestWindow =
  | { hours: number; available: false }
  | {
      hours: number;
      available: true;
      day: string;
      start: string;
      end: string;
      average: number;
      vs_reference_pct: number;
      start_index: number;
      slot_count: number;
    };

export type Extreme = { time: string; day: string; price: number };

export type Payload = {
  ok: true;
  stale: boolean;
  region: { code: string; name: string };
  reference: { price: number; label: string; short: string };
  now: PricePoint;
  next: (PricePoint & { delta: number }) | null;
  window: {
    until: string;
    includes_tomorrow: boolean;
    tomorrow_pending: boolean;
    slot_count: number;
  };
  stats: {
    min: Extreme;
    max: Extreme;
    average: number;
    below_reference_pct: number;
    negative_count: number;
  };
  chart: {
    axis_max: number;
    axis_min: number;
    reference_y: number;
    zero_y: number;
    ticks: Tick[];
    tomorrow_index: number | null;
    tomorrow_label: string | null;
  };
  slots: Slot[];
  windows: CheapestWindow[];
  slot_label: string;
};

export type ErrorPayload = { ok: false; error: string };
```

- [ ] **Step 2: Write the failing time tests**

`test/time.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test test/time.test.ts`
Expected: FAIL, cannot resolve `../src/time`.

- [ ] **Step 4: Write time.ts**

```ts
const TIME_ZONE = "Europe/London";
export const SLOT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

function parts(date: Date): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") result[part.type] = part.value;
  }
  return result;
}

/** Start of the half-hour slot containing the given instant. */
export function slotStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / SLOT_MS) * SLOT_MS);
}

/** Start of the half-hour slot after the one containing the given instant. */
export function nextSlotStart(date: Date): Date {
  return new Date(slotStart(date).getTime() + SLOT_MS);
}

export function londonTime(date: Date): string {
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}

export function londonDate(date: Date): string {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function londonHour(date: Date): number {
  return Number(parts(date).hour);
}

export function londonMinute(date: Date): number {
  return Number(parts(date).minute);
}

export function londonWeekday(date: Date): string {
  return parts(date).weekday;
}

/** "Today", "Tomorrow", or the short weekday, by London calendar date. */
export function dayLabel(date: Date, now: Date): string {
  const target = londonDate(date);
  if (target === londonDate(now)) return "Today";
  if (target === londonDate(new Date(now.getTime() + DAY_MS))) return "Tomorrow";
  return londonWeekday(date);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test test/time.test.ts && pnpm typecheck`
Expected: PASS (7 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/time.ts test/time.test.ts
git commit -m "feat: add payload types and Europe/London time helpers"
```

---

### Task 3: Regions and query parameter parsing

**Files:**
- Create: `src/regions.ts`, `src/params.ts`, `test/regions.test.ts`, `test/params.test.ts`

**Interfaces:**
- Produces from `src/regions.ts`: `REGIONS: Record<string, string>`, `REGION_CODES: string[]`, `FALLBACK_REFERENCE: Record<string, number>`, `parseRegion(raw: string | undefined): string | null`.
- Produces from `src/params.ts`: `DEFAULT_DURATIONS`, `parseDurations(raw: string | undefined): number[] | null`, `parseAt(raw: string | undefined): Date | null | undefined` (undefined = not supplied, null = invalid).

- [ ] **Step 1: Write the failing region tests**

`test/regions.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing params tests**

`test/params.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test test/regions.test.ts test/params.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write regions.ts**

```ts
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
```

- [ ] **Step 5: Write params.ts**

```ts
export const DEFAULT_DURATIONS = [2, 3];
const MAX_DURATIONS = 4;
const MIN_HOURS = 0.5;
const MAX_HOURS = 12;

/**
 * Parses "2,3" into [2, 3]. Order and duplicates are preserved because the
 * template pairs each window with an appliance name by position.
 */
export function parseDurations(raw: string | undefined): number[] | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DURATIONS;
  const values = raw.split(",").map((part) => Number(part.trim()));
  if (values.length > MAX_DURATIONS) return null;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    if (value < MIN_HOURS || value > MAX_HOURS) return null;
    if (!Number.isInteger(value * 2)) return null;
  }
  return values;
}

/** undefined when not supplied, null when unparseable, otherwise the instant. */
export function parseAt(raw: string | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test test/regions.test.ts test/params.test.ts && pnpm typecheck`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/regions.ts src/params.ts test/regions.test.ts test/params.test.ts
git commit -m "feat: add region table and query parameter parsing"
```

---

### Task 4: Shaping primitives

**Files:**
- Create: `src/shape.ts`, `test/helpers.ts`, `test/shape.test.ts`

**Interfaces:**
- Consumes: `Rate`, `Band` from `src/types.ts`.
- Produces from `src/shape.ts`: `NoCurrentSlotError`, `round1(n)`, `selectSlots(rates, now)`, `bandFor(price, reference)`, `vsReferencePct(price, reference)`, `cheapestWindow(prices, size)`.
- Produces from `test/helpers.ts`: `REFERENCE`, `MORNING`, `EVENING`, `TODAY_END`, `TOMORROW_END`, `agileRows(until)`, `agileBody(until)`, `flexibleBody`, `withNegative(rows)`.

- [ ] **Step 1: Write the test helpers**

`test/helpers.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing primitive tests**

`test/shape.test.ts` (first block; later tasks append to this file):

```ts
import { describe, expect, it } from "vitest";
import {
  bandFor,
  cheapestWindow,
  NoCurrentSlotError,
  round1,
  selectSlots,
  vsReferencePct,
} from "../src/shape";
import { agileRows, MORNING, REFERENCE, TODAY_END } from "./helpers";

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(22.323)).toBe(22.3);
    expect(round1(-0.34)).toBe(-0.3);
  });
});

describe("selectSlots", () => {
  it("returns the current slot and everything after it, oldest first", () => {
    const slots = selectSlots(agileRows(TODAY_END), MORNING);
    expect(slots).toHaveLength(28);
    expect(slots[0].valid_from).toBe("2026-09-08T08:00:00Z");
    expect(slots[27].valid_to).toBe("2026-09-08T22:00:00Z");
  });

  it("throws when nothing covers now", () => {
    expect(() => selectSlots(agileRows(TODAY_END), new Date("2026-09-09T05:00:00Z"))).toThrow(NoCurrentSlotError);
    expect(() => selectSlots([], MORNING)).toThrow(NoCurrentSlotError);
  });
});

describe("bandFor and vsReferencePct", () => {
  it("classifies against the reference", () => {
    expect(bandFor(-0.1, REFERENCE)).toBe("negative");
    expect(bandFor(0, REFERENCE)).toBe("negative");
    expect(bandFor(10, REFERENCE)).toBe("below");
    expect(bandFor(REFERENCE, REFERENCE)).toBe("above");
    expect(bandFor(40, REFERENCE)).toBe("above");
  });

  it("gives a signed integer percentage", () => {
    expect(vsReferencePct(22.323, REFERENCE)).toBe(-15);
    expect(vsReferencePct(46, REFERENCE)).toBe(75);
  });
});

describe("cheapestWindow", () => {
  it("finds the lowest-average contiguous run", () => {
    expect(cheapestWindow([5, 1, 1, 9, 2, 2, 2], 2)).toEqual({ start: 1, average: 1 });
    expect(cheapestWindow([5, 1, 1, 9, 2, 2, 2], 3)).toEqual({ start: 4, average: 2 });
  });

  it("prefers the earliest on ties", () => {
    expect(cheapestWindow([3, 3, 3, 3], 2)).toEqual({ start: 0, average: 3 });
  });

  it("returns null when too few prices", () => {
    expect(cheapestWindow([1, 2], 3)).toBeNull();
    expect(cheapestWindow([], 1)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test test/shape.test.ts`
Expected: FAIL, cannot resolve `../src/shape`.

- [ ] **Step 4: Write the primitives in shape.ts**

```ts
import type { Band, Rate } from "./types";

export class NoCurrentSlotError extends Error {
  constructor() {
    super("No Agile price covers the current half hour");
    this.name = "NoCurrentSlotError";
  }
}

export const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Rates from the slot containing `now` to the last published slot, oldest first. */
export function selectSlots(rates: Rate[], now: Date): Rate[] {
  const t = now.getTime();
  const sorted = [...rates].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const index = sorted.findIndex((rate) => Date.parse(rate.valid_from) <= t && t < Date.parse(rate.valid_to));
  if (index < 0) throw new NoCurrentSlotError();
  return sorted.slice(index);
}

export function bandFor(price: number, reference: number): Band {
  if (price <= 0) return "negative";
  return price < reference ? "below" : "above";
}

export function vsReferencePct(price: number, reference: number): number {
  return Math.round(((price - reference) / reference) * 100);
}

/** Sliding-window minimum mean. Earliest start wins ties. */
export function cheapestWindow(prices: number[], size: number): { start: number; average: number } | null {
  if (size < 1 || prices.length < size) return null;
  let sum = 0;
  for (let i = 0; i < size; i++) sum += prices[i];
  let bestStart = 0;
  let bestSum = sum;
  for (let i = size; i < prices.length; i++) {
    sum += prices[i] - prices[i - size];
    if (sum < bestSum - 1e-9) {
      bestSum = sum;
      bestStart = i - size + 1;
    }
  }
  return { start: bestStart, average: bestSum / size };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test test/shape.test.ts && pnpm typecheck`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shape.ts test/helpers.ts test/shape.test.ts
git commit -m "feat: add slot selection, banding and cheapest window search"
```

---

### Task 5: Chart geometry and window wording

**Files:**
- Modify: `src/shape.ts`, `test/shape.test.ts`

**Interfaces:**
- Produces from `src/shape.ts`: `Axis`, `chartAxis(prices, reference)`, `barGeometry(price, axis)`, `ticksFor(starts)`, `tomorrowIndex(starts, now)`, `windowUntil(lastEnd, now)`, `tomorrowPending(lastEnd, now)`.

- [ ] **Step 1: Append the failing geometry tests**

Append to `test/shape.test.ts` (add the new imports to the existing import from `../src/shape`, and import `EVENING`, `TOMORROW_END` from `./helpers`):

```ts
import { barGeometry, chartAxis, ticksFor, tomorrowIndex, tomorrowPending, windowUntil } from "../src/shape";
import { EVENING, TOMORROW_END } from "./helpers";

describe("chartAxis", () => {
  it("rounds the top up to a multiple of ten and keeps room for the reference", () => {
    const axis = chartAxis([10, 46], REFERENCE);
    expect(axis.axis_max).toBe(50);
    expect(axis.axis_min).toBe(0);
    expect(axis.zero_y).toBe(100);
    expect(axis.reference_y).toBe(47.3);
  });

  it("raises the top when the reference is near the maximum", () => {
    expect(chartAxis([10, 26], REFERENCE).axis_max).toBe(40);
  });

  it("extends below zero for negative prices", () => {
    const axis = chartAxis([-1.5, 46], REFERENCE);
    expect(axis.axis_min).toBe(-5);
    expect(axis.zero_y).toBe(90.9);
  });
});

describe("barGeometry", () => {
  const axis = chartAxis([-1.5, 46], REFERENCE);

  it("draws positive bars up from zero", () => {
    expect(barGeometry(46, axis)).toEqual({ y: 7.3, h: 83.6 });
  });

  it("draws negative bars down from zero", () => {
    expect(barGeometry(-1.5, axis)).toEqual({ y: 90.9, h: 2.7 });
  });
});

describe("ticksFor", () => {
  const starts = (until: string, now: Date) => selectSlots(agileRows(until), now).map((r) => new Date(r.valid_from));

  it("marks the first slot and every three-hour boundary", () => {
    expect(ticksFor(starts(TODAY_END, MORNING))).toEqual([
      { index: 0, label: "09:00" },
      { index: 6, label: "12:00" },
      { index: 12, label: "15:00" },
      { index: 18, label: "18:00" },
      { index: 24, label: "21:00" },
    ]);
  });

  it("drops a boundary tick that would collide with the first label", () => {
    const ticks = ticksFor(starts(TOMORROW_END, EVENING));
    expect(ticks.slice(0, 4)).toEqual([
      { index: 0, label: "17:30" },
      { index: 7, label: "21:00" },
      { index: 13, label: "00:00" },
      { index: 19, label: "03:00" },
    ]);
  });
});

describe("tomorrowIndex", () => {
  const starts = (until: string, now: Date) => selectSlots(agileRows(until), now).map((r) => new Date(r.valid_from));

  it("is null when the window stays within today", () => {
    expect(tomorrowIndex(starts(TODAY_END, MORNING), MORNING)).toBeNull();
  });

  it("points at the first slot on tomorrow's London date", () => {
    expect(tomorrowIndex(starts(TOMORROW_END, EVENING), EVENING)).toBe(13);
  });
});

describe("windowUntil and tomorrowPending", () => {
  it("describes the end of the window", () => {
    expect(windowUntil(new Date("2026-09-08T22:00:00Z"), MORNING)).toBe("23:00 today");
    expect(windowUntil(new Date("2026-09-09T22:00:00Z"), EVENING)).toBe("23:00 tomorrow");
  });

  it("flags a missing tomorrow only after 16:00 London time", () => {
    expect(tomorrowPending(new Date("2026-09-08T22:00:00Z"), MORNING)).toBe(false);
    expect(tomorrowPending(new Date("2026-09-08T22:00:00Z"), EVENING)).toBe(true);
    expect(tomorrowPending(new Date("2026-09-09T22:00:00Z"), EVENING)).toBe(false);
    expect(tomorrowPending(new Date("2026-09-09T22:00:00Z"), new Date("2026-09-08T22:30:00Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test test/shape.test.ts`
Expected: FAIL, `chartAxis` is not exported.

- [ ] **Step 3: Add the geometry functions to shape.ts**

Append to `src/shape.ts` (add `import { londonDate, londonHour, londonMinute, londonTime } from "./time";` and `Tick` to the types import at the top):

```ts
export type Axis = {
  axis_max: number;
  axis_min: number;
  zero_y: number;
  reference_y: number;
  yFor: (price: number) => number;
};

/** Y axis in price units; y positions are percentages from the top. */
export function chartAxis(prices: number[], reference: number): Axis {
  const top = Math.max(...prices, reference + 5);
  const bottom = Math.min(...prices, 0);
  const axis_max = Math.ceil(top / 10) * 10;
  const axis_min = bottom < 0 ? Math.floor(bottom / 5) * 5 : 0;
  const span = axis_max - axis_min;
  const yFor = (price: number) => round1(((axis_max - price) / span) * 100);
  return { axis_max, axis_min, zero_y: yFor(0), reference_y: yFor(reference), yFor };
}

export function barGeometry(price: number, axis: Axis): { y: number; h: number } {
  if (price >= 0) {
    const y = axis.yFor(price);
    return { y, h: round1(axis.zero_y - y) };
  }
  return { y: axis.zero_y, h: round1(axis.yFor(price) - axis.zero_y) };
}

const TICK_HOURS = 3;
const TICK_CLEARANCE = 3;

/** The first slot plus every three-hour boundary, skipping boundaries too close to the first label. */
export function ticksFor(starts: Date[]): Tick[] {
  const ticks: Tick[] = [];
  starts.forEach((start, index) => {
    if (index === 0) {
      ticks.push({ index, label: londonTime(start) });
      return;
    }
    if (index < TICK_CLEARANCE) return;
    if (londonMinute(start) === 0 && londonHour(start) % TICK_HOURS === 0) {
      ticks.push({ index, label: londonTime(start) });
    }
  });
  return ticks;
}

export function tomorrowIndex(starts: Date[], now: Date): number | null {
  const today = londonDate(now);
  const index = starts.findIndex((start) => londonDate(start) !== today);
  return index < 0 ? null : index;
}

function endsToday(lastEnd: Date, now: Date): boolean {
  return londonDate(new Date(lastEnd.getTime() - 1)) === londonDate(now);
}

export function windowUntil(lastEnd: Date, now: Date): string {
  return `${londonTime(lastEnd)} ${endsToday(lastEnd, now) ? "today" : "tomorrow"}`;
}

const PUBLICATION_HOUR = 16;

export function tomorrowPending(lastEnd: Date, now: Date): boolean {
  return londonHour(now) >= PUBLICATION_HOUR && endsToday(lastEnd, now);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test test/shape.test.ts && pnpm typecheck`
Expected: PASS (all shape tests, 21 so far).

- [ ] **Step 5: Commit**

```bash
git add src/shape.ts test/shape.test.ts
git commit -m "feat: add chart axis, tick and window wording helpers"
```

---

### Task 6: Full payload shaping

**Files:**
- Modify: `src/shape.ts`, `test/shape.test.ts`

**Interfaces:**
- Consumes: `REGIONS` from `src/regions.ts`; `dayLabel`, `londonWeekday` from `src/time.ts`.
- Produces from `src/shape.ts`: `ShapeInput`, `shape(input: ShapeInput): Payload`.

- [ ] **Step 1: Append the failing payload tests**

Append to `test/shape.test.ts` (add `shape` to the `../src/shape` import and `withNegative` to the `./helpers` import):

```ts
import { shape } from "../src/shape";
import { withNegative } from "./helpers";

const reference = { price: REFERENCE, label: "Flexible Octopus", short: "Flexible" };

describe("shape – morning", () => {
  const payload = shape({ region: "C", agile: agileRows(TODAY_END), reference, durations: [2, 3], now: MORNING });

  it("describes region, reference and the current slot", () => {
    expect(payload.ok).toBe(true);
    expect(payload.stale).toBe(false);
    expect(payload.region).toEqual({ code: "C", name: "London" });
    expect(payload.reference).toEqual({ price: 26.3, label: "Flexible Octopus", short: "Flexible" });
    expect(payload.now).toEqual({ time: "09:00", end: "09:30", price: 22.3, vs_reference_pct: -15, band: "below" });
    expect(payload.next).toEqual({ time: "09:30", end: "10:00", price: 21.7, vs_reference_pct: -18, band: "below", delta: -0.6 });
    expect(payload.slot_label).toBe("09:00");
  });

  it("covers the rest of today", () => {
    expect(payload.window).toEqual({ until: "23:00 today", includes_tomorrow: false, tomorrow_pending: false, slot_count: 28 });
    expect(payload.slots).toHaveLength(28);
    expect(payload.slots[0]).toMatchObject({ time: "09:00", price: 22.3, band: "below" });
  });

  it("summarises the window", () => {
    expect(payload.stats).toEqual({
      min: { time: "14:30", day: "Today", price: 6.7 },
      max: { time: "18:30", day: "Today", price: 46 },
      average: 23.8,
      below_reference_pct: 54,
      negative_count: 0,
    });
  });

  it("lays out the chart", () => {
    expect(payload.chart.axis_max).toBe(50);
    expect(payload.chart.axis_min).toBe(0);
    expect(payload.chart.reference_y).toBe(47.3);
    expect(payload.chart.zero_y).toBe(100);
    expect(payload.chart.ticks[1]).toEqual({ index: 6, label: "12:00" });
    expect(payload.chart.tomorrow_index).toBeNull();
    expect(payload.chart.tomorrow_label).toBeNull();
  });

  it("finds the cheapest windows in the requested order", () => {
    expect(payload.windows).toEqual([
      { hours: 2, available: true, day: "Today", start: "13:30", end: "15:30", average: 7.5, vs_reference_pct: -72, start_index: 9, slot_count: 4 },
      { hours: 3, available: true, day: "Today", start: "13:00", end: "16:00", average: 8.1, vs_reference_pct: -69, start_index: 8, slot_count: 6 },
    ]);
  });

  it("stays small", () => {
    expect(JSON.stringify(payload).length).toBeLessThan(20_000);
  });
});

describe("shape – evening with tomorrow", () => {
  const payload = shape({ region: "C", agile: agileRows(TOMORROW_END), reference, durations: [2, 3], now: EVENING });

  it("extends into tomorrow", () => {
    expect(payload.window).toEqual({ until: "23:00 tomorrow", includes_tomorrow: true, tomorrow_pending: false, slot_count: 59 });
    expect(payload.chart.tomorrow_index).toBe(13);
    expect(payload.chart.tomorrow_label).toBe("Wed");
    expect(payload.chart.axis_max).toBe(60);
  });

  it("labels windows that start tomorrow", () => {
    expect(payload.windows[0]).toMatchObject({ hours: 2, available: true, day: "Tomorrow", start: "03:00", end: "05:00", average: 21.8, start_index: 19 });
    expect(payload.windows[1]).toMatchObject({ hours: 3, day: "Tomorrow", start: "02:00", end: "05:00", start_index: 17 });
  });

  it("stays small with the longest window", () => {
    expect(JSON.stringify(payload).length).toBeLessThan(20_000);
  });
});

describe("shape – evening before publication", () => {
  const payload = shape({ region: "C", agile: agileRows(TODAY_END), reference, durations: [2, 12], now: EVENING });

  it("flags that tomorrow is pending", () => {
    expect(payload.window).toEqual({ until: "23:00 today", includes_tomorrow: false, tomorrow_pending: true, slot_count: 11 });
  });

  it("reports a window that no longer fits", () => {
    expect(payload.windows[0]).toMatchObject({ hours: 2, available: true, start: "21:00", end: "23:00", average: 28.3, vs_reference_pct: 8 });
    expect(payload.windows[1]).toEqual({ hours: 12, available: false });
  });
});

describe("shape – negative prices", () => {
  const payload = shape({ region: "C", agile: withNegative(agileRows(TODAY_END)), reference, durations: [2], now: MORNING });

  it("counts and bands negative slots and extends the axis", () => {
    expect(payload.stats.negative_count).toBe(2);
    expect(payload.stats.min).toEqual({ time: "13:00", day: "Today", price: -1.5 });
    expect(payload.chart.axis_min).toBe(-5);
    expect(payload.chart.zero_y).toBe(90.9);
    expect(payload.slots[8]).toEqual({ time: "13:00", price: -1.5, band: "negative", y: 90.9, h: 2.7 });
  });

  it("pulls the cheapest window over the negative slots", () => {
    const window = payload.windows[0];
    expect(window.available).toBe(true);
    if (window.available) {
      expect(window.start_index).toBeLessThanOrEqual(8);
      expect(window.start_index + window.slot_count).toBeGreaterThan(8);
    }
  });
});

describe("shape – last slot", () => {
  it("has no next when the current slot is the final one", () => {
    const rows = agileRows(TODAY_END);
    const payload = shape({ region: "C", agile: rows, reference, durations: [2], now: new Date("2026-09-08T21:45:00Z") });
    expect(payload.next).toBeNull();
    expect(payload.windows[0]).toEqual({ hours: 2, available: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test test/shape.test.ts`
Expected: FAIL, `shape` is not exported.

- [ ] **Step 3: Add shape() to shape.ts**

Append to `src/shape.ts` (extend the imports: `import { REGIONS } from "./regions";`, add `dayLabel`, `londonWeekday` to the `./time` import, and add `CheapestWindow`, `Extreme`, `Payload`, `PricePoint`, `Slot` to the types import):

```ts
export type ShapeInput = {
  region: string;
  agile: Rate[];
  reference: { price: number; label: string; short: string };
  durations: number[];
  now: Date;
};

function pricePoint(rate: Rate, reference: number): PricePoint {
  return {
    time: londonTime(new Date(rate.valid_from)),
    end: londonTime(new Date(rate.valid_to)),
    price: round1(rate.value_inc_vat),
    vs_reference_pct: vsReferencePct(rate.value_inc_vat, reference),
    band: bandFor(rate.value_inc_vat, reference),
  };
}

function extreme(rates: Rate[], index: number, now: Date): Extreme {
  const start = new Date(rates[index].valid_from);
  return { time: londonTime(start), day: dayLabel(start, now), price: round1(rates[index].value_inc_vat) };
}

function windowsFor(rates: Rate[], prices: number[], durations: number[], reference: number, now: Date): CheapestWindow[] {
  return durations.map((hours) => {
    const size = Math.round(hours * 2);
    const found = cheapestWindow(prices, size);
    if (!found) return { hours, available: false };
    const start = new Date(rates[found.start].valid_from);
    const end = new Date(rates[found.start + size - 1].valid_to);
    return {
      hours,
      available: true,
      day: dayLabel(start, now),
      start: londonTime(start),
      end: londonTime(end),
      average: round1(found.average),
      vs_reference_pct: vsReferencePct(found.average, reference),
      start_index: found.start,
      slot_count: size,
    };
  });
}

/** Builds the polling payload. Throws NoCurrentSlotError when `agile` does not cover `now`. */
export function shape(input: ShapeInput): Payload {
  const { now, durations } = input;
  const reference = input.reference.price;
  const rates = selectSlots(input.agile, now);
  const starts = rates.map((rate) => new Date(rate.valid_from));
  const prices = rates.map((rate) => rate.value_inc_vat);
  const axis = chartAxis(prices, reference);
  const lastEnd = new Date(rates[rates.length - 1].valid_to);
  const current = pricePoint(rates[0], reference);
  const nextRate = rates[1];
  const minIndex = prices.indexOf(Math.min(...prices));
  const maxIndex = prices.indexOf(Math.max(...prices));
  const tomorrowAt = tomorrowIndex(starts, now);

  const slots: Slot[] = rates.map((rate, index) => ({
    time: londonTime(starts[index]),
    price: round1(rate.value_inc_vat),
    band: bandFor(rate.value_inc_vat, reference),
    ...barGeometry(rate.value_inc_vat, axis),
  }));

  return {
    ok: true,
    stale: false,
    region: { code: input.region, name: REGIONS[input.region] ?? input.region },
    reference: { price: round1(reference), label: input.reference.label, short: input.reference.short },
    now: current,
    next: nextRate
      ? { ...pricePoint(nextRate, reference), delta: round1(nextRate.value_inc_vat - rates[0].value_inc_vat) }
      : null,
    window: {
      until: windowUntil(lastEnd, now),
      includes_tomorrow: tomorrowAt !== null,
      tomorrow_pending: tomorrowPending(lastEnd, now),
      slot_count: rates.length,
    },
    stats: {
      min: extreme(rates, minIndex, now),
      max: extreme(rates, maxIndex, now),
      average: round1(prices.reduce((sum, price) => sum + price, 0) / prices.length),
      below_reference_pct: Math.round((prices.filter((price) => price < reference).length / prices.length) * 100),
      negative_count: prices.filter((price) => price <= 0).length,
    },
    chart: {
      axis_max: axis.axis_max,
      axis_min: axis.axis_min,
      reference_y: axis.reference_y,
      zero_y: axis.zero_y,
      ticks: ticksFor(starts),
      tomorrow_index: tomorrowAt,
      tomorrow_label: tomorrowAt === null ? null : londonWeekday(starts[tomorrowAt]),
    },
    slots,
    windows: windowsFor(rates, prices, durations, reference, now),
    slot_label: current.time,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. If a rounding assertion is off by 0.1, print the actual value and check it against the fixture with the Python snippet in the spec's Testing section before changing an expectation; the expected values were computed from the fixture and should match.

- [ ] **Step 5: Commit**

```bash
git add src/shape.ts test/shape.test.ts
git commit -m "feat: shape Agile rates into the plugin payload"
```

---

### Task 7: Octopus API client

**Files:**
- Create: `src/octopus.ts`, `test/octopus.test.ts`

**Interfaces:**
- Produces: `AGILE_PRODUCT`, `FLEXIBLE_PRODUCT`, `REFERENCE_LABEL`, `REFERENCE_SHORT`, `Fetcher`, `unitRatesUrl(product, region, from, to, pageSize)`, `fetchAgileRates(region, from, fetcher?)`, `fetchFlexibleRate(region, at, fetcher?)`.

- [ ] **Step 1: Write the failing client tests**

`test/octopus.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { fetchAgileRates, fetchFlexibleRate, unitRatesUrl } from "../src/octopus";
import { agileBody, flexibleBody, MORNING, TODAY_END } from "./helpers";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

const octopus = () => fetchMock.get("https://api.octopus.energy");

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
    octopus()
      .intercept({ path: (p) => p.includes("AGILE-24-10-01-C") && p.includes("period_from=2026-09-08T08%3A00%3A00.000Z") && p.includes("period_to=2026-09-10T08%3A00%3A00.000Z") })
      .reply(200, agileBody(TODAY_END));
    const rates = await fetchAgileRates("C", new Date("2026-09-08T08:00:00Z"));
    expect(rates[0].valid_from < rates[rates.length - 1].valid_from).toBe(true);
    expect(rates).toHaveLength(agileBody(TODAY_END).results.length);
  });

  it("throws on a non-2xx response", async () => {
    octopus().intercept({ path: (p) => p.includes("AGILE-24-10-01-C") }).reply(503, "down");
    await expect(fetchAgileRates("C", MORNING)).rejects.toThrow("503");
  });

  it("throws when results is missing", async () => {
    octopus().intercept({ path: (p) => p.includes("AGILE-24-10-01-C") }).reply(200, { detail: "nope" });
    await expect(fetchAgileRates("C", MORNING)).rejects.toThrow("results");
  });
});

describe("fetchFlexibleRate", () => {
  it("returns the direct debit rate", async () => {
    octopus().intercept({ path: (p) => p.includes("VAR-22-11-01-C") }).reply(200, flexibleBody);
    expect(await fetchFlexibleRate("C", MORNING)).toBe(26.347335);
  });

  it("returns null when no rows come back", async () => {
    octopus().intercept({ path: (p) => p.includes("VAR-22-11-01-C") }).reply(200, { results: [] });
    expect(await fetchFlexibleRate("C", MORNING)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test test/octopus.test.ts`
Expected: FAIL, cannot resolve `../src/octopus`.

- [ ] **Step 3: Write octopus.ts**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test test/octopus.test.ts && pnpm typecheck`
Expected: PASS (6 tests). If `fetchMock` reports the interceptor path did not match, log `p` inside the matcher: undici passes the path with query string, percent-encoded as built by `URL`.

- [ ] **Step 5: Commit**

```bash
git add src/octopus.ts test/octopus.test.ts
git commit -m "feat: add Octopus unit-rates client"
```

---

### Task 8: Cache keys and TTL

**Files:**
- Create: `src/cache.ts`, `test/cache.test.ts`

**Interfaces:**
- Consumes: `nextSlotStart`, `SLOT_MS` from `src/time.ts`.
- Produces: `LAST_GOOD_TTL_SECONDS`, `PENDING_TTL_SECONDS`, `periodKey(region, durations, now): Request`, `lastGoodKey(region, durations): Request`, `ttlSeconds(now, tomorrowPending): number`.

- [ ] **Step 1: Write the failing cache tests**

`test/cache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test test/cache.test.ts`
Expected: FAIL, cannot resolve `../src/cache`.

- [ ] **Step 3: Write cache.ts**

```ts
import { nextSlotStart, SLOT_MS } from "./time";

/** Synthetic origin for Cache API keys; never fetched. */
const KEY_ORIGIN = "https://cache.trmnl-octopus.internal";

export const LAST_GOOD_TTL_SECONDS = 48 * 60 * 60;
export const PENDING_TTL_SECONDS = 5 * 60;
const MIN_TTL_SECONDS = 30;

function durationsKey(durations: number[]): string {
  return durations.join(",");
}

/** Key for the cached payload of one region, duration list and half-hour period. */
export function periodKey(region: string, durations: number[], now: Date): Request {
  const period = Math.floor(now.getTime() / SLOT_MS);
  return new Request(`${KEY_ORIGIN}/trmnl?region=${region}&durations=${durationsKey(durations)}&period=${period}`);
}

/** Key for the most recent successful payload, served when upstream fails. */
export function lastGoodKey(region: string, durations: number[]): Request {
  return new Request(`${KEY_ORIGIN}/last-good?region=${region}&durations=${durationsKey(durations)}`);
}

/** Seconds until the next half hour, shortened to five minutes while tomorrow's prices are awaited. */
export function ttlSeconds(now: Date, tomorrowPending: boolean): number {
  const untilBoundary = Math.ceil((nextSlotStart(now).getTime() - now.getTime()) / 1000);
  const ttl = tomorrowPending ? Math.min(untilBoundary, PENDING_TTL_SECONDS) : untilBoundary;
  return Math.max(ttl, MIN_TTL_SECONDS);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test test/cache.test.ts && pnpm typecheck`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts test/cache.test.ts
git commit -m "feat: add cache keys and half-hour TTL rule"
```

---

### Task 9: The /trmnl handler

**Files:**
- Modify: `src/index.ts`
- Create: `test/handler.test.ts`

**Interfaces:**
- Consumes everything from Tasks 2 to 8.
- Produces: `GET /trmnl` on the app from `createApp`.

- [ ] **Step 1: Write the failing handler tests**

`test/handler.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import { createApp } from "../src/index";
import type { Payload } from "../src/types";
import { agileBody, EVENING, flexibleBody, MORNING, TODAY_END, TOMORROW_END } from "./helpers";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

const octopus = () => fetchMock.get("https://api.octopus.energy");
const agilePath = (p: string) => p.includes("AGILE-24-10-01");
const flexiblePath = (p: string) => p.includes("VAR-22-11-01");

async function get(app: ReturnType<typeof createApp>, path: string) {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`http://localhost${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("GET /trmnl validation", () => {
  const app = createApp({ now: () => MORNING });

  it("rejects a missing or unknown region", async () => {
    const missing = await get(app, "/trmnl");
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ ok: false });
    const unknown = await get(app, "/trmnl?region=I");
    expect(unknown.status).toBe(400);
  });

  it("rejects bad durations and bad at", async () => {
    expect((await get(app, "/trmnl?region=C&durations=99")).status).toBe(400);
    expect((await get(app, "/trmnl?region=C&at=soon")).status).toBe(400);
  });
});

describe("GET /trmnl success", () => {
  it("returns a shaped payload with half-hour caching", async () => {
    octopus().intercept({ path: agilePath }).reply(200, agileBody(TODAY_END));
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const app = createApp({ now: () => MORNING });

    const response = await get(app, "/trmnl?region=c&durations=2,3");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=1500");
    const payload = (await response.json()) as Payload;
    expect(payload.ok).toBe(true);
    expect(payload.stale).toBe(false);
    expect(payload.region.code).toBe("C");
    expect(payload.reference.label).toBe("Flexible Octopus");
    expect(payload.windows).toHaveLength(2);
  });

  it("serves the second request in the same period from cache", async () => {
    octopus().intercept({ path: agilePath }).reply(200, agileBody(TODAY_END));
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const app = createApp({ now: () => new Date("2026-09-08T09:05:00Z") });

    const first = (await (await get(app, "/trmnl?region=D")).json()) as Payload;
    const second = (await (await get(app, "/trmnl?region=D")).json()) as Payload;
    expect(second).toEqual(first);
    expect(second.stale).toBe(false);
  });

  it("shortens the TTL while tomorrow is pending", async () => {
    octopus().intercept({ path: agilePath }).reply(200, agileBody(TODAY_END));
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const app = createApp({ now: () => EVENING });

    const response = await get(app, "/trmnl?region=E");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    const payload = (await response.json()) as Payload;
    expect(payload.window.tomorrow_pending).toBe(true);
  });

  it("bypasses the cache and honours at", async () => {
    octopus().intercept({ path: agilePath }).reply(200, agileBody(TOMORROW_END));
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const app = createApp({ now: () => MORNING });

    const response = await get(app, `/trmnl?region=F&at=${EVENING.toISOString()}`);
    const payload = (await response.json()) as Payload;
    expect(payload.now.time).toBe("17:30");
    expect(payload.window.includes_tomorrow).toBe(true);
  });

  it("falls back to the typical reference when Flexible fails", async () => {
    octopus().intercept({ path: agilePath }).reply(200, agileBody(TODAY_END));
    octopus().intercept({ path: flexiblePath }).reply(500, "boom");
    const app = createApp({ now: () => MORNING });

    const payload = (await (await get(app, "/trmnl?region=G")).json()) as Payload;
    expect(payload.reference.label).toBe("Typical variable");
    expect(payload.reference.short).toBe("typical");
  });
});

describe("GET /trmnl failures", () => {
  it("returns 502 when Agile fails and nothing is cached", async () => {
    octopus().intercept({ path: agilePath }).reply(500, "boom");
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const app = createApp({ now: () => MORNING });

    const response = await get(app, "/trmnl?region=H");
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("serves the last good payload as stale when Agile fails later", async () => {
    octopus().intercept({ path: agilePath }).reply(200, agileBody(TODAY_END));
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const app = createApp({ now: () => new Date("2026-09-08T10:05:00Z") });
    const good = (await (await get(app, "/trmnl?region=J")).json()) as Payload;

    octopus().intercept({ path: agilePath }).reply(500, "boom");
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const later = createApp({ now: () => new Date("2026-09-08T10:35:00Z") });
    const response = await get(later, "/trmnl?region=J");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const stale = (await response.json()) as Payload;
    expect(stale.stale).toBe(true);
    expect(stale.slots).toEqual(good.slots);
  });

  it("treats an empty Agile response as a failure", async () => {
    octopus().intercept({ path: agilePath }).reply(200, { results: [] });
    octopus().intercept({ path: flexiblePath }).reply(200, flexibleBody);
    const app = createApp({ now: () => MORNING });
    expect((await get(app, "/trmnl?region=K")).status).toBe(502);
  });
});
```

Each test uses a different region so cached entries cannot leak between tests even if the pool does not isolate the Cache API per test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test test/handler.test.ts`
Expected: FAIL, `/trmnl` returns 404.

- [ ] **Step 3: Implement the route in index.ts**

Replace `src/index.ts` with:

```ts
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

function errorBody(error: string): ErrorPayload {
  return { ok: false, error };
}

export function createApp(options: AppOptions = {}) {
  const clock = options.now ?? (() => new Date());
  const fetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const app = new Hono();

  app.get("/", (c) => c.html(homepage));

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/trmnl", async (c) => {
    const region = parseRegion(c.req.query("region"));
    if (!region) {
      return c.json(errorBody(`region must be one of ${REGION_CODES.join(", ")}`), 400);
    }
    const durations = parseDurations(c.req.query("durations"));
    if (!durations) {
      return c.json(errorBody("durations must be up to four comma-separated hours between 0.5 and 12 in half-hour steps"), 400);
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
        return c.json(stale, 200, { "Cache-Control": "no-store" });
      }
      return c.json(errorBody("Octopus Energy prices are unavailable at the moment"), 502, { "Cache-Control": "no-store" });
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
```

Create a placeholder `src/homepage.ts` so the import resolves (Task 10 fills it in):

```ts
export const homepage = "<!doctype html><title>TRMNL Octopus Agile</title><p>Coming soon.</p>";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Notes if something fails:
- `c.executionCtx` throws outside a Worker request; tests pass a real context via `app.fetch(request, env, ctx)`.
- If `cache.match` returns the cached hit and Vitest complains the body was already used, the `response.clone()` in `cache.put` is missing.
- If the stale test sees `stale: false`, the last-good `cache.put` did not finish before the second request; `waitOnExecutionContext(ctx)` in the helper waits for `waitUntil` promises.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/homepage.ts test/handler.test.ts
git commit -m "feat: serve shaped Agile payload from /trmnl with caching and fallbacks"
```

---

### Task 10: Homepage and README

**Files:**
- Modify: `src/homepage.ts`
- Create: `README.md`
- Modify: `test/health.test.ts` (add a homepage assertion)

- [ ] **Step 1: Add a homepage test**

Append to `test/health.test.ts`:

```ts
describe("GET /", () => {
  it("serves the homepage", async () => {
    const app = createApp();
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request("http://localhost/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Not an Octopus Energy product");
    expect(html).toContain("/trmnl?region=");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test test/health.test.ts`
Expected: FAIL, the placeholder homepage lacks the disclaimer.

- [ ] **Step 3: Write the homepage**

`src/homepage.ts`:

```ts
export const homepage = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TRMNL Octopus Agile</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
    code { background: #f2f2f2; padding: 0.1rem 0.3rem; border-radius: 3px; }
    footer { margin-top: 3rem; font-size: 0.9rem; color: #666; }
  </style>
</head>
<body>
  <h1>TRMNL Octopus Agile</h1>
  <p>A TRMNL e-ink plugin showing the Octopus Agile electricity price ahead: the rest of today in the morning, and today plus tomorrow once next-day prices are published around 16:00. It draws a price chart against the Flexible Octopus variable tariff and picks the cheapest windows for a washing machine and a dishwasher.</p>
  <h2>Install</h2>
  <p>Search for "Agile Octopus prices" in the TRMNL recipes directory, choose your electricity region and, optionally, your appliance run times.</p>
  <h2>API</h2>
  <p>The plugin polls <code>/trmnl?region=C&amp;durations=2,3</code>. <code>region</code> is your DNO letter (A to P, no I or O). <code>durations</code> lists appliance run lengths in hours. Responses are cached until the next half hour.</p>
  <p>Source code is on <a href="https://github.com/MattieTK/trmnl-octopus">GitHub</a>.</p>
  <footer>Data: Octopus Energy public API. Not an Octopus Energy product.</footer>
</body>
</html>`;
```

- [ ] **Step 4: Write README.md**

```markdown
# TRMNL Octopus Agile

A TRMNL e-ink plugin for the Octopus Agile electricity tariff. It shows the
price ahead as a bar chart against the Flexible Octopus variable tariff, the
current and next price, the cheapest and peak slots, and the cheapest windows
to run a washing machine and a dishwasher.

A Cloudflare Worker fetches and shapes the data; the TRMNL plugin polls it
every 15 minutes. Not an Octopus Energy product.

## Worker

```sh
pnpm install
pnpm test
pnpm dev           # http://localhost:8787/trmnl?region=C
pnpm deploy
```

`GET /trmnl?region=C&durations=2,3` returns the plugin payload. `region` is
the DNO letter (A–P, no I or O). `durations` is a comma-separated list of
appliance run lengths in hours (default `2,3`). Add `at=<ISO timestamp>` to
preview a different time of day; such responses bypass the cache.

Responses are cached per region until the next half hour, or for five minutes
after 16:00 while tomorrow's prices are awaited. If Octopus is unreachable
the last good payload is served with `stale: true`.

## Plugin

The TRMNL plugin lives in `plugin/`. Preview it locally with the trmnlp
Docker image while the Worker runs on port 8787:

```sh
pnpm dev --ip 0.0.0.0
cd plugin
docker run --rm --pull always -p 4567:4567 \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd):/plugin" trmnl/trmnlp serve
```

`plugin/.trmnlp.yml` points the polling URL at the local Worker and pins the
preview time with `at=`. Change `dev_query` there to see the morning, evening
or pending states.

Push to your TRMNL account with `trmnlp push` (after `trmnlp login`), or
zip `plugin/src/*` and import it as a private plugin.

## Design

See `docs/notes/2026-09-09-design.md`.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/homepage.ts README.md test/health.test.ts
git commit -m "docs: add homepage and README"
```

---

### Task 11: TRMNL plugin settings and preview config

**Files:**
- Create: `plugin/src/settings.yml`, `plugin/.trmnlp.yml`, `plugin/.gitignore`

**Interfaces:**
- Produces the custom field keynames the template reads: `region`, `appliance_1`, `appliance_1_hours`, `appliance_2`, `appliance_2_hours`.
- The polling URL host is a placeholder until the Worker is deployed in Task 13.

- [ ] **Step 1: Write settings.yml**

`plugin/src/settings.yml`:

```yaml
---
name: Agile Octopus prices
description: Agile price ahead and best times
strategy: polling
polling_verb: GET
polling_url: "{{ api_base | default: 'https://trmnl-octopus.WORKERS_SUBDOMAIN.workers.dev' }}/trmnl?region={{ region }}&durations={{ appliance_1_hours }},{{ appliance_2_hours }}{{ dev_query }}"
refresh_interval: 15
no_screen_padding: "no"
dark_mode: "no"
framework_version: latest
custom_fields:
  - keyname: region
    name: Electricity region
    field_type: select
    description: The last letter of your Agile tariff code, or look it up by postcode at https://api.octopus.energy/v1/industry/grid-supply-points/?postcode=YOURPOSTCODE
    default: C
    options:
      - "Eastern England (A):A"
      - "East Midlands (B):B"
      - "London (C):C"
      - "Merseyside and North Wales (D):D"
      - "West Midlands (E):E"
      - "North East England (F):F"
      - "North West England (G):G"
      - "Southern England (H):H"
      - "South East England (J):J"
      - "South Wales (K):K"
      - "South West England (L):L"
      - "Yorkshire (M):M"
      - "Southern Scotland (N):N"
      - "Northern Scotland (P):P"
  - keyname: appliance_1
    name: Appliance 1
    field_type: string
    default: Washing machine
    description: Shown on the first best-time card.
  - keyname: appliance_1_hours
    name: Appliance 1 run time (hours)
    field_type: number
    default: 2
    min: 0.5
    max: 12
    step: 0.5
  - keyname: appliance_2
    name: Appliance 2
    field_type: string
    default: Dishwasher
    description: Shown on the second best-time card.
  - keyname: appliance_2_hours
    name: Appliance 2 run time (hours)
    field_type: number
    default: 3
    min: 0.5
    max: 12
    step: 0.5
```

`api_base` and `dev_query` are not form fields. On TRMNL they render as empty, so the URL falls back to the production host with no suffix. Locally, `.trmnlp.yml` supplies them.

- [ ] **Step 2: Write .trmnlp.yml**

`plugin/.trmnlp.yml`:

```yaml
---
watch:
  - src
  - .trmnlp.yml

time_zone: Europe/London

custom_fields:
  region: C
  appliance_1: Washing machine
  appliance_1_hours: "2"
  appliance_2: Dishwasher
  appliance_2_hours: "3"
  # Local-only overrides. Switch dev_query between the morning, evening and pending states:
  #   "&at=2026-09-08T08:05:00Z"  morning, today only
  #   "&at=2026-09-08T16:35:00Z"  evening, today and tomorrow (once tomorrow is published)
  #   ""                          live data
  api_base: http://host.docker.internal:8787
  dev_query: ""

variables:
  trmnl:
    user:
      first_name: Preview
    plugin_settings:
      instance_name: Agile Octopus prices
```

- [ ] **Step 3: Write plugin/.gitignore**

```
_build/
```

- [ ] **Step 4: Lint the plugin definition**

Run:

```bash
cd plugin && docker run --rm --pull always -v "$(pwd):/plugin" trmnl/trmnlp lint; cd ..
```

Expected: lint reports only the missing `full.liquid` (written in Task 12), or passes. If the image cannot be pulled, note it and continue; lint is repeated in Task 12.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/settings.yml plugin/.trmnlp.yml plugin/.gitignore
git commit -m "feat: add TRMNL plugin settings and local preview config"
```

---

### Task 12: The full-screen Liquid template

**Files:**
- Create: `plugin/src/full.liquid`

**Interfaces:**
- Consumes the payload keys from `src/types.ts` as top-level Liquid variables (`ok`, `stale`, `region`, `reference`, `now`, `next`, `window`, `stats`, `chart`, `slots`, `windows`, `slot_label`) and the custom field values via `trmnl.plugin_settings.custom_fields_values`.

- [ ] **Step 1: Write full.liquid**

```liquid
{%- comment -%}
  Agile Octopus prices – full view.
  Data comes from the Worker payload (see src/types.ts). The chart is inline
  SVG so nothing runs at screenshot time. Chart geometry uses a 1000x320
  viewBox; the payload supplies bar tops and heights as percentages.
{%- endcomment -%}
{%- assign fields = trmnl.plugin_settings.custom_fields_values -%}
{%- assign appliance_names = fields.appliance_1 | default: "Appliance 1" | append: "|" | append: fields.appliance_2 | default: "Appliance 2" | split: "|" -%}

<style>
  .agile-chart { display: block; width: 100%; height: auto; }
  .agile-chart .bar--below,
  .agile-chart .bar--negative { fill: #000; }
  .agile-chart .bar--above { fill: url(#agile-hatch); }
  .agile-chart .window-shade { fill: url(#agile-dots); }
  .screen--4bit .agile-chart .bar--above { fill: #8c8c8c; }
  .screen--4bit .agile-chart .window-shade { fill: #dcdcdc; }
  .agile-chart .axis { stroke: #000; stroke-width: 2; }
  .agile-chart .ref-line { stroke: #000; stroke-width: 2.5; stroke-dasharray: 10 7; }
  .agile-chart .day-line { stroke: #000; stroke-width: 2; stroke-dasharray: 2 5; }
  .agile-chart .chart-text { font-family: inherit; font-size: 20px; fill: #000; }
  .agile-chart .chart-text--bold { font-weight: 700; }
  .agile-chart .now-marker { fill: #000; }
</style>

<div class="view view--full">
  <div class="layout layout--col gap--small">
  {%- if ok == false -%}
    <div class="flex flex--col flex--center gap--small" style="height: 100%">
      <span class="value value--xlarge">Prices unavailable</span>
      <span class="label">{{ error }}</span>
    </div>
  {%- else -%}

    {%- comment -%} Headline tiles {%- endcomment -%}
    <div class="grid grid--cols-4 lg:grid--cols-5 gap--medium">
      <div class="flex flex--col">
        <span class="label label--small">Now · {{ now.time }}–{{ now.end }}</span>
        <span class="value value--large lg:value--xlarge value--tnums">{{ now.price }}p</span>
        <span class="label label--small">{{ now.vs_reference_pct | abs }}% {% if now.vs_reference_pct < 0 %}below{% else %}above{% endif %} {{ reference.short }}</span>
      </div>
      <div class="flex flex--col">
        {%- if next -%}
        <span class="label label--small">Next · {{ next.time }}</span>
        <span class="value value--large lg:value--xlarge value--tnums">{{ next.price }}p</span>
        <span class="label label--small">{% if next.delta > 0 %}up {{ next.delta }}p{% elsif next.delta < 0 %}down {{ next.delta | abs }}p{% else %}no change{% endif %}</span>
        {%- else -%}
        <span class="label label--small">Next</span>
        <span class="value value--large lg:value--xlarge">–</span>
        <span class="label label--small">awaiting prices</span>
        {%- endif -%}
      </div>
      <div class="flex flex--col">
        <span class="label label--small">Cheapest · {{ stats.min.day }} {{ stats.min.time }}</span>
        <span class="value value--large lg:value--xlarge value--tnums">{{ stats.min.price }}p</span>
        <span class="label label--small">average {{ stats.average }}p</span>
      </div>
      <div class="flex flex--col">
        <span class="label label--small">Peak · {{ stats.max.day }} {{ stats.max.time }}</span>
        <span class="value value--large lg:value--xlarge value--tnums">{{ stats.max.price }}p</span>
        <span class="label label--small">{{ stats.negative_count }} negative slot{% if stats.negative_count != 1 %}s{% endif %}</span>
      </div>
      <div class="hidden lg:flex flex--col">
        <span class="label label--small">{{ reference.label }}</span>
        <span class="value value--large lg:value--xlarge value--tnums">{{ reference.price }}p</span>
        <span class="label label--small">{{ stats.below_reference_pct }}% of slots cheaper</span>
      </div>
    </div>

    {%- comment -%} Chart {%- endcomment -%}
    {%- assign plot_x = 46 -%}
    {%- assign plot_y = 26 -%}
    {%- assign plot_w = 944 -%}
    {%- assign plot_h = 220 -%}
    {%- assign plot_bottom = plot_y | plus: plot_h -%}
    {%- assign bar_w = plot_w | times: 1.0 | divided_by: window.slot_count -%}
    {%- assign bar_gap = bar_w | times: 0.12 -%}
    {%- assign bar_draw_w = bar_w | minus: bar_gap -%}
    {%- assign ref_y = chart.reference_y | times: plot_h | divided_by: 100.0 | plus: plot_y -%}
    {%- assign zero_y = chart.zero_y | times: plot_h | divided_by: 100.0 | plus: plot_y -%}
    {%- assign axis_span = chart.axis_max | minus: chart.axis_min -%}
    {%- assign mid_value = chart.axis_max | divided_by: 2 -%}
    {%- assign mid_y = chart.axis_max | minus: mid_value | times: plot_h | divided_by: axis_span | plus: plot_y -%}

    <div class="flex flex--col gap--xsmall">
      <div class="flex flex--row flex--between">
        <span class="label label--small">Prices until {{ window.until }} (p/kWh){% if window.tomorrow_pending %} · tomorrow's prices due about 16:00{% endif %}</span>
        <span class="label label--small">dark bars below {{ reference.short }} · light bars above</span>
      </div>
      <svg class="agile-chart" viewBox="0 0 1000 320" role="img" aria-label="Agile prices ahead">
        <defs>
          <pattern id="agile-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2.5" height="7" fill="#000"></rect>
          </pattern>
          <pattern id="agile-dots" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="1.2" fill="#000"></circle>
          </pattern>
        </defs>

        {%- for w in windows -%}
          {%- if w.available -%}
            {%- assign shade_x = w.start_index | times: bar_w | plus: plot_x -%}
            {%- assign shade_w = w.slot_count | times: bar_w -%}
            <rect class="window-shade" x="{{ shade_x }}" y="{{ plot_y }}" width="{{ shade_w }}" height="{{ plot_h }}"></rect>
            <text class="chart-text chart-text--bold" x="{{ shade_x | plus: 4 }}" y="{{ plot_y | minus: 8 }}">{{ appliance_names[forloop.index0] }}</text>
          {%- endif -%}
        {%- endfor -%}

        {%- for slot in slots -%}
          {%- assign x = forloop.index0 | times: bar_w | plus: plot_x | plus: bar_gap | divided_by: 1.0 -%}
          {%- assign y = slot.y | times: plot_h | divided_by: 100.0 | plus: plot_y -%}
          {%- assign h = slot.h | times: plot_h | divided_by: 100.0 -%}
          <rect class="bar bar--{{ slot.band }}" x="{{ x }}" y="{{ y }}" width="{{ bar_draw_w }}" height="{{ h }}"></rect>
        {%- endfor -%}

        <line class="axis" x1="{{ plot_x }}" y1="{{ zero_y }}" x2="{{ plot_x | plus: plot_w }}" y2="{{ zero_y }}"></line>
        <line class="axis" x1="{{ plot_x }}" y1="{{ plot_y }}" x2="{{ plot_x }}" y2="{{ plot_bottom }}"></line>

        <line class="ref-line" x1="{{ plot_x }}" y1="{{ ref_y }}" x2="{{ plot_x | plus: plot_w }}" y2="{{ ref_y }}"></line>
        <text class="chart-text chart-text--bold" x="{{ plot_x | plus: plot_w }}" y="{{ ref_y | minus: 6 }}" text-anchor="end">{{ reference.short }} {{ reference.price }}p</text>

        <text class="chart-text" x="{{ plot_x | minus: 8 }}" y="{{ plot_y | plus: 7 }}" text-anchor="end">{{ chart.axis_max }}</text>
        <text class="chart-text" x="{{ plot_x | minus: 8 }}" y="{{ mid_y | plus: 7 }}" text-anchor="end">{{ mid_value }}</text>
        <text class="chart-text" x="{{ plot_x | minus: 8 }}" y="{{ zero_y | plus: 7 }}" text-anchor="end">0</text>
        {%- if chart.axis_min < 0 -%}
        <text class="chart-text" x="{{ plot_x | minus: 8 }}" y="{{ plot_bottom | plus: 7 }}" text-anchor="end">{{ chart.axis_min }}</text>
        {%- endif -%}

        {%- if chart.tomorrow_index -%}
          {%- assign day_x = chart.tomorrow_index | times: bar_w | plus: plot_x -%}
          <line class="day-line" x1="{{ day_x }}" y1="{{ plot_y }}" x2="{{ day_x }}" y2="{{ plot_bottom | plus: 8 }}"></line>
          <text class="chart-text chart-text--bold" x="{{ day_x | plus: 6 }}" y="{{ plot_y | plus: 18 }}">{{ chart.tomorrow_label }}</text>
        {%- endif -%}

        {%- for tick in chart.ticks -%}
          {%- assign tick_x = tick.index | times: bar_w | plus: plot_x | plus: bar_gap -%}
          <line class="axis" x1="{{ tick_x }}" y1="{{ plot_bottom }}" x2="{{ tick_x }}" y2="{{ plot_bottom | plus: 8 }}"></line>
          <text class="chart-text" x="{{ tick_x }}" y="{{ plot_bottom | plus: 30 }}" text-anchor="{% if tick.index == 0 %}start{% else %}middle{% endif %}">{{ tick.label }}</text>
        {%- endfor -%}

        {%- assign now_x = bar_draw_w | divided_by: 2.0 | plus: plot_x | plus: bar_gap -%}
        <polygon class="now-marker" points="{{ now_x | minus: 7 }},{{ plot_bottom | plus: 52 }} {{ now_x | plus: 7 }},{{ plot_bottom | plus: 52 }} {{ now_x }},{{ plot_bottom | plus: 40 }}"></polygon>
        <text class="chart-text chart-text--bold" x="{{ now_x | plus: 12 }}" y="{{ plot_bottom | plus: 52 }}">Now</text>
      </svg>
    </div>

    {%- comment -%} Best times {%- endcomment -%}
    <div class="grid grid--cols-2 gap--medium">
      {%- for w in windows -%}
      <div class="flex flex--col gap--xsmall p--2.5 rounded--medium bg--gray-75">
        <span class="label label--small">{{ appliance_names[forloop.index0] }} · {{ w.hours }}h</span>
        {%- if w.available -%}
        <span class="value value--base lg:value--large value--tnums">{{ w.day }} {{ w.start }}–{{ w.end }}</span>
        <span class="label label--small">average {{ w.average }}p · {{ w.vs_reference_pct | abs }}% {% if w.vs_reference_pct < 0 %}below{% else %}above{% endif %} {{ reference.short }}</span>
        {%- else -%}
        <span class="value value--base lg:value--large">Not enough prices yet</span>
        <span class="label label--small">check again after 16:00</span>
        {%- endif -%}
      </div>
      {%- endfor -%}
    </div>

    <span class="label label--small">Data: Octopus Energy public API · Not an Octopus product{% if stale %} · prices may be out of date{% endif %}</span>
  {%- endif -%}
  </div>

  <div class="title_bar">
    <span class="title">Agile Octopus prices</span>
    <span class="instance">{{ region.name }} · slot {{ slot_label }}</span>
  </div>
</div>
```

Notes for the implementer:
- Liquid integer division truncates; every geometric expression multiplies by `1.0` or divides by a float first.
- `flex--between` may not exist in Framework 3.3; if the legend does not right-align in the preview, use `flex flex--row flex--space-between` or wrap the two labels in a `columns` block. Check the Flex doc at https://trmnl.com/framework/docs/3.3/flex.
- `.screen--4bit` scoping relies on TRMNL wrapping the markup in the screen element with that class; verify in the TRMNL X preview and fall back to `4bit:`-prefixed background utilities on a wrapping `div` if the SVG fill does not change.

- [ ] **Step 2: Start the Worker and the preview**

Terminal 1:

```bash
pnpm dev --ip 0.0.0.0
```

Terminal 2:

```bash
cd plugin && docker run --rm --pull always -p 4567:4567 --add-host=host.docker.internal:host-gateway -v "$(pwd):/plugin" trmnl/trmnlp serve
```

Open http://localhost:4567 and check the full view. Set `dev_query` in `.trmnlp.yml` to `"&at=2026-09-08T08:05:00Z"` for the morning state, then `"&at=2026-09-08T16:35:00Z"` for the evening state (the live API now holds only data from today, so the evening state renders the pending layout until after 16:00; that is expected and useful).

Expected: tiles, chart with reference line, now marker, ticks, shaded windows and the two cards render without Liquid errors. Nothing overflows on the 800x480 preview.

- [ ] **Step 3: Render PNGs for both devices**

```bash
cd plugin && docker run --rm -v "$(pwd):/plugin" --add-host=host.docker.internal:host-gateway trmnl/trmnlp build --png --width 800 --height 480 --color-depth 1 && cp _build/full.png ../docs/preview-og.png
docker run --rm -v "$(pwd):/plugin" --add-host=host.docker.internal:host-gateway trmnl/trmnlp build --png --width 1040 --height 780 --color-depth 4 && cp _build/full.png ../docs/preview-x.png; cd ..
```

If PNG rendering is unavailable in the image (no Firefox), open http://localhost:4567/full in a browser at 800x480 and 1040x780 and screenshot instead. Look at both images: labels legible, hatch distinct from solid on 1-bit, grey distinct on 4-bit, no clipping.

- [ ] **Step 4: Lint**

```bash
cd plugin && docker run --rm -v "$(pwd):/plugin" trmnl/trmnlp lint; cd ..
```

Expected: exit 0. Fix any reported issue that is not a style-block warning; a warning about the `<style>` block is accepted for now (see spec risks).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/full.liquid docs/preview-og.png docs/preview-x.png
git commit -m "feat: add full-screen Liquid template with inline SVG price chart"
```

---

### Task 13: Deploy and wire the polling URL

**Files:**
- Modify: `plugin/src/settings.yml` (replace `WORKERS_SUBDOMAIN`)
- Modify: `README.md` (add the deployed URL)

- [ ] **Step 1: Check Cloudflare credentials**

```bash
pnpm exec wrangler whoami
```

Expected: an account name. If not logged in and no `CLOUDFLARE_API_TOKEN` is set, stop here and report: deployment needs `pnpm exec wrangler login` in an interactive terminal. Everything before this task is complete and committed.

- [ ] **Step 2: Deploy**

```bash
pnpm deploy
```

Expected: a `https://trmnl-octopus.<subdomain>.workers.dev` URL in the output.

- [ ] **Step 3: Verify the live endpoint**

```bash
curl -s "https://trmnl-octopus.<subdomain>.workers.dev/trmnl?region=C" | head -c 600
curl -sI "https://trmnl-octopus.<subdomain>.workers.dev/trmnl?region=C" | grep -i cache-control
```

Expected: `"ok":true`, region London, a `Cache-Control: public, max-age=` header.

- [ ] **Step 4: Update the polling URL and README**

Replace `WORKERS_SUBDOMAIN` in `plugin/src/settings.yml` with the real subdomain. Add the deployed URL to the README under "Worker".

- [ ] **Step 5: Run the full test suite once more**

```bash
pnpm test && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add plugin/src/settings.yml README.md
git commit -m "chore: point plugin at deployed Worker"
git push
```

- [ ] **Step 7: Report**

Tell the user: the Worker URL, how to install the plugin (`trmnlp login` then `trmnlp push` from `plugin/`, or import the ZIP of `plugin/src`), what was verified, and the two open items from the spec (bit-depth CSS hook on a real device, the 1 October VAT check).
