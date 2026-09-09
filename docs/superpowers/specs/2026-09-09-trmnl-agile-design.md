# TRMNL Octopus Agile – design

Date: 2026-09-09
Status: approved in discussion, awaiting spec review

## Summary

A TRMNL e-ink plugin that shows the Octopus Agile electricity price ahead:
the rest of today in the morning, and today plus tomorrow once next-day
prices are published (around 16:00 UK). It is a public recipe usable by any
UK Agile customer. A Cloudflare Worker fetches and shapes the data; a Liquid
template renders it. The display is glanceable: a bar chart of the price
ahead with a reference line for the Flexible Octopus variable tariff, a
row of headline numbers, and the cheapest windows for a washing machine and
a dishwasher.

This is not an Octopus Energy product. No Octopus logo or branding is used.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Audience | Public TRMNL recipe | Same model as the published LaMetric app |
| Worker location | New Worker in this repo | LaMetric backend stays untouched |
| Reference price | Flexible Octopus, fetched per region | Always current; matches the regional Ofgem cap |
| Top times | Cheapest contiguous windows for fixed durations | Appliances need a block, not scattered slots |
| Layouts | Full view, tuned for TRMNL X, working on the original | One template with responsive prefixes |
| Rendering | Worker computes, Liquid draws inline SVG | No JavaScript, no partial screenshots, testable in one place |
| TRMNL strategy | Polling every 15 minutes | Only strategy available to recipes |
| Chart window | Current slot to end of published data | Gives "day ahead" in the morning and "evening plus tomorrow" after 16:00 without a mode switch |
| Bottom row | Washing machine and dishwasher only | Two cards, no jargon |

## Background facts the design relies on

- Agile product `AGILE-24-10-01`, tariff `E-1R-AGILE-24-10-01-<REGION>`,
  regions A–P (no I or O). Unit rates come from
  `https://api.octopus.energy/v1/products/<product>/electricity-tariffs/<tariff>/standard-unit-rates/`
  with `period_from`, `period_to` (UTC, `Z` suffix) and `page_size`. No auth.
  Results are newest-first. Slots are 30 minutes. The Agile day runs 23:00 to
  23:00 UK time; next-day prices appear between 16:00 and 20:00, usually near
  16:00. Per-slot cap of 100p/kWh inc VAT.
- Flexible Octopus is product `VAR-22-11-01`, tariff
  `E-1R-VAR-22-11-01-<REGION>`, same endpoint shape. It returns two rows per
  period; use `payment_method == "DIRECT_DEBIT"`. Rates change quarterly and
  match the regional Ofgem cap to two decimals.
- VAT on domestic electricity is 0% from 1 October 2026 to 31 March 2027. At
  the time of writing the API's `value_inc_vat` for Q4 still equals
  `value_exc_vat * 1.05`. We use `value_inc_vat` for both tariffs so the
  comparison is internally consistent. Re-check on 1 October.
- TRMNL polling: TRMNL's server fetches a JSON URL, merges top-level keys into
  Liquid variables, and renders a screenshot. Response limit 100 KB. Refresh
  intervals 15, 60, 360, 720, 1440 minutes, not cron-aligned. TRMNL skips
  re-rendering when merge variables are unchanged.
- TRMNL X renders at 1040x780 logical pixels, 4-bit grey, framework size class
  `lg`. The original renders at 800x480, 1-bit, size class `md`. Framework
  prefixes: `md:`, `lg:`, `1bit:`, `2bit:`, `4bit:`, `portrait:`.
- Liquid in the polling URL can reference plugin form fields as `{{ keyname }}`.
  Templates read them as `trmnl.plugin_settings.custom_fields_values.<keyname>`.

## Repository layout

```
trmnl-octopus/
  package.json            pnpm, hono, wrangler, vitest, @cloudflare/vitest-pool-workers
  wrangler.jsonc          name trmnl-octopus, nodejs_compat, observability on
  tsconfig.json
  src/
    index.ts              Hono app: /, /health, /trmnl
    octopus.ts            fetch Agile and Flexible rates (network only)
    shape.ts              pure functions: slots, bands, windows, stats, chart geometry
    regions.ts            region letter -> name map
    cache.ts              cache key, TTL rule, last-good fallback
    time.ts               Europe/London formatting helpers
  test/
    fixtures/             recorded Octopus JSON (see Testing)
    shape.test.ts
    cache.test.ts
    handler.test.ts
  plugin/
    .trmnlp.yml           local preview config (custom field values, local polling URL)
    src/
      settings.yml        strategy, polling_url, refresh_interval, custom_fields
      full.liquid         the screen
  docs/superpowers/specs/ this document
  README.md
```

The Worker is deployed with `wrangler deploy` to a workers.dev URL for now.
A custom domain can be added later without changing the plugin beyond the
polling URL.

## Worker

### Routes

- `GET /` – short HTML page: what the plugin is, link to the recipe, link to
  the GitHub repo, disclaimer. Mirrors the LaMetric Worker's homepage in
  spirit, without its demo widget.
- `GET /health` – `{ "ok": true }`.
- `GET /trmnl` – the plugin data endpoint.

### `/trmnl` query parameters

| Parameter | Required | Format | Default |
|---|---|---|---|
| `region` | yes | single letter A–P, case-insensitive | none; 400 if missing or invalid |
| `durations` | no | comma-separated hours, each 0.5–12 in 0.5 steps, at most 4 values | `2,3` |
| `at` | no | ISO 8601 timestamp; overrides "now" | real time |

`at` exists so the morning and evening states can be exercised locally and in
the plugin preview. Responses that use `at` are not cached.

### Upstream calls

For a cache miss the Worker makes two requests in parallel:

1. Agile rates: `period_from` = start of the current half-hour slot (UTC),
   `period_to` = `period_from` + 48 hours, `page_size=100`. At most 96 rows,
   so one page suffices. Sort ascending by `valid_from`.
2. Flexible rates: `period_from` = now, `period_to` = now + 30 minutes,
   `page_size=10`. Take the `DIRECT_DEBIT` row's `value_inc_vat`.

Both use `Accept: application/json` and a `User-Agent` naming the project and
repo URL. A 10-second timeout applies to each.

### Response shape

All prices are pence per kWh inc VAT, rounded to one decimal place for display
fields. Local times are Europe/London, 24-hour `HH:MM`. Day labels are
`Today` or `Tomorrow` by London calendar date.

```json
{
  "ok": true,
  "stale": false,
  "region": { "code": "C", "name": "London" },
  "reference": { "price": 26.4, "label": "Flexible Octopus" },
  "now":  { "time": "09:00", "end": "09:30", "price": 12.8, "vs_reference_pct": -51, "band": "below" },
  "next": { "time": "09:30", "end": "10:00", "price": 18.4, "vs_reference_pct": -30, "band": "below", "delta": 5.6 },
  "window": {
    "until": "23:00 tomorrow",
    "includes_tomorrow": true,
    "tomorrow_pending": false,
    "slot_count": 76
  },
  "stats": {
    "min": { "time": "13:00", "day": "Today", "price": 6.2 },
    "max": { "time": "17:30", "day": "Today", "price": 42.8 },
    "average": 18.2,
    "below_reference_pct": 70,
    "negative_count": 0
  },
  "chart": {
    "axis_max": 60,
    "axis_min": 0,
    "reference_y": 56,
    "zero_y": 100,
    "ticks": [ { "index": 0, "label": "09:00" }, { "index": 6, "label": "12:00" } ],
    "tomorrow_index": 28
  },
  "slots": [
    { "time": "09:00", "price": 12.8, "band": "below", "y": 78.7, "h": 21.3 }
  ],
  "windows": [
    {
      "hours": 2,
      "available": true,
      "day": "Today",
      "start": "13:00",
      "end": "15:00",
      "average": 6.4,
      "vs_reference_pct": -76,
      "start_index": 8,
      "slot_count": 4
    }
  ],
  "slot_label": "09:00"
}
```

Field notes:

- `next.delta` is `next.price - now.price`, one decimal place.
- `band` is `negative` (price <= 0), `below` (0 < price < reference), or
  `above` (price >= reference).
- `y` and `h` are percentages of chart height; the bar rectangle is drawn at
  top `y`, height `h`. Negative prices draw from `zero_y` downward. `axis_min`
  is 0 unless negative prices exist, in which case it is the negative minimum
  rounded down to the nearest 5.
- `axis_max` is the larger of the window's maximum price and the reference
  price plus 5, rounded up to the nearest 10.
- `reference_y` and `zero_y` are percentages of chart height.
- `ticks` fall on every slot whose local time is on a three-hour boundary
  (00, 03, 06, ...). The first slot always gets a tick.
- `tomorrow_index` is the index of the first slot on tomorrow's London date, or
  `null` when the window does not reach midnight.
- `slot_label` is the current slot's start time; it is the only "updated at"
  indicator, so the payload does not change between polls within one slot.
- `windows` preserves the order of `durations`. When fewer slots remain than
  the duration needs, the entry is `{ "hours": 2, "available": false }`.
- On error: `{ "ok": false, "error": "human-readable message" }` with HTTP 400
  for bad input, 502 for upstream failure with no last-good copy.

Payload size: 96 slots at roughly 60 bytes each plus the fixed fields is about
7 KB, well under the 100 KB polling limit.

### Shaping rules

- **Slot window**: all Agile rows from the current slot (the one containing
  "now") to the last published row. If the current slot is missing (the API
  has not returned it), respond with the upstream-failure path.
- **Cheapest window** for `n` slots (`hours * 2`): sliding window over the
  slot list, lowest mean price wins, earliest wins ties. Windows for
  different durations are computed independently and may overlap.
- **Stats** are over the same slot list as the chart. `below_reference_pct`
  is the share of slots with `band` not `above`, rounded to an integer.
- **`vs_reference_pct`** is `round((price - reference) / reference * 100)`.
- **`window.until`**: `"23:00 tonight"` when the last slot ends today
  (London date), otherwise `"HH:MM tomorrow"` using the last slot's end time.
- **`tomorrow_pending`**: true when London time is at or after 16:00 and the
  last slot ends before 23:00 tomorrow.

### Caching

- Key: the request URL with `region` upper-cased and `durations` normalised
  (sorted, deduplicated), plus a period bucket header so entries roll over at
  the half-hour boundary, as the LaMetric Worker does.
- TTL: until the next half-hour boundary, except that when `tomorrow_pending`
  is true the TTL is the lesser of that and five minutes, so tomorrow's prices
  arrive on the device soon after publication.
- Last-good copy: each successful payload is also written to a second cache
  entry keyed by region and durations only, with a 48-hour TTL. When the
  upstream fetch fails, the Worker serves this copy with `stale: true` and
  `Cache-Control: no-store`. The template shows "prices may be out of date"
  when `stale` is true.
- Requests with `at` bypass the cache entirely.

### Error handling

| Condition | Behaviour |
|---|---|
| Missing or invalid `region` | 400, `ok: false`, message lists valid letters |
| Invalid `durations` | 400, `ok: false` |
| Octopus non-2xx, timeout, or malformed JSON | serve last-good with `stale: true`, else 502 `ok: false` |
| Flexible rate missing | proceed with a fallback reference from a hard-coded per-region table updated each quarter, and `reference.label` = "Typical variable" |
| No current slot in Agile response | treated as upstream failure |
| Fewer slots than a window needs | that window reports `available: false` |

Errors are logged with structured context (region, period, status), matching
the style of the LaMetric Worker.

## Plugin

### `settings.yml`

- `strategy: polling`, `polling_verb: GET`, `refresh_interval: 15`.
- `polling_url`: `https://<worker>/trmnl?region={{ region }}&durations={{ appliance_1_hours }},{{ appliance_2_hours }}`
- `custom_fields`:
  - `region` – `select`, required, options in `Label:Value` form for the 14
    regions, e.g. `London (C):C`, `Eastern England (A):A`. Help text links to
    the Octopus postcode lookup so users can find their letter.
  - `appliance_1` – `string`, default `Washing machine`.
  - `appliance_1_hours` – `number`, default `2`, min 0.5, max 12, step 0.5.
  - `appliance_2` – `string`, default `Dishwasher`.
  - `appliance_2_hours` – `number`, default `3`, same bounds.
- `name`, `description` (35 characters max), `no_screen_padding: false`,
  `framework_version` pinned to the current 3.x release.

### `full.liquid`

Structure, top to bottom, inside `screen > view view--full`:

1. **Title bar**: "Agile prices · {{ region.name }}" on the left; date and
   the current slot time on the right, computed in Liquid from
   `trmnl.user.utc_offset` rather than from the payload so it follows the
   user's locale for the date.
2. **Stats row** of five tiles (four on the original device, the Flexible tile
   is `md:hidden`): Now (large value, `vs_reference_pct` label), Next (value,
   time, delta arrow), Cheapest (value, time, day), Peak (value, time, day),
   Flexible (reference price, `below_reference_pct` "of slots cheaper").
3. **Chart**: heading "Prices until {{ window.until }} (p/kWh)" with a legend
   "solid: below Flexible, hatched: above". If `stats.negative_count > 0`,
   the heading gains "· {{ n }} negative slots". Below it an inline SVG:
   - `viewBox="0 0 1000 300"`, width 100%, height fixed per breakpoint via
     class (`md:` shorter, `lg:` taller).
   - Bar width = plot width / `window.slot_count`, small gap between bars.
   - One `<rect>` per slot with class `bar bar--{{ band }}`.
   - Window shading: a `<rect>` per available window behind the bars, light
     pattern fill, with the appliance name as a small `<text>` above it.
   - Reference line: dashed horizontal `<line>` at `chart.reference_y` with a
     right-aligned label "Flexible 26.4p".
   - Zero line when `axis_min < 0`.
   - Now marker: a small triangle and "Now" under the first bar.
   - Day boundary: dotted vertical line at `chart.tomorrow_index` labelled
     with tomorrow's weekday.
   - Axis: tick marks and labels from `chart.ticks`; y labels at
     `axis_min`, 0, mid, `axis_max`.
4. **Best times row**: two cards, one per window: appliance name and hours,
   day and start–end, average price and `vs_reference_pct`. When
   `available` is false the card says "Not enough prices yet".
5. **Footer**: "Data: Octopus Energy public API · Not an Octopus product ·
   slot {{ slot_label }}", plus "prices may be out of date" when `stale`.

Error state: when `ok` is false, render the title bar, a large "Prices
unavailable" value and the `error` message, nothing else.

### Styling and bit depth

A `<style>` block in the template defines the SVG classes:

- `.bar--below` solid black, `.bar--above` a diagonal hatch `<pattern>`,
  `.bar--negative` solid black drawn below the zero line.
- `.window-shade` a sparse dot pattern.
- On 4-bit devices the hatch and dot patterns are replaced by mid and light
  greys using the framework's bit-depth scoping. The exact class hook is to be
  confirmed in the preview tool during implementation; the fallback is to
  keep patterns on all devices, which also read fine on the X.

Chef (recipe lint) discourages inline styles for layout, colour and font
size. Layout and typography use framework classes only. The `<style>` block
is confined to SVG fills and patterns. If review pushes back, fills move to
`fill` attributes on the elements.

### Local preview

`plugin/.trmnlp.yml` sets `custom_fields` values (region C, the two
appliances) and overrides the polling URL to the local Worker at
`http://host.docker.internal:8787/trmnl?...` for the trmnlp Docker image.
Use `?at=` to preview the morning and evening states. `trmnlp build --png`
at 800x480 depth 1 and 1040x780 depth 4 produces the two device renders.

## Testing

- Fixtures under `test/fixtures/` recorded from the real API on 2026-09-09:
  `agile-c-morning.json` (today only), `agile-c-evening.json` (today and
  tomorrow), `flexible-c.json`. A hand-edited `agile-negative.json` adds
  negative slots. The pre-publication evening case is the morning fixture
  with `at` set to 16:30.
- `shape.test.ts`: slot window selection, band classification against the
  reference, cheapest-window search (tie goes to earliest, overlapping
  durations, too few slots), stats, `window.until` wording, `tomorrow_pending`,
  chart geometry (axis rounding, negative axis, tick placement,
  `tomorrow_index`), payload size stays under 20 KB with 96 slots.
- `cache.test.ts`: key normalisation, TTL to the half-hour boundary, five-minute
  TTL while pending, `at` bypass.
- `handler.test.ts` (Workers pool, fetch mocked): 200 shape on success, 400 on
  bad region and durations, stale fallback on upstream 500, 502 with no
  last-good copy, Flexible fallback path, headers.
- Template: trmnlp render at both sizes checked by eye for the morning,
  evening, pending, negative, stale and error states; `trmnlp lint` before
  publishing.

## Publishing

1. Deploy the Worker, confirm `/trmnl?region=C` from a browser.
2. Push the plugin with `trmnlp push` (or import the ZIP) into your account,
   attach to the X, check both device renders.
3. Publish as Unlisted first to get a shareable link, then submit as a recipe
   once it has run for a few days.

## Non-goals for this version

- Half and quadrant views (added later if wanted, the payload already
  supports them).
- Consumption, cost or standing charges (needs account auth).
- Export tariff, Intelligent Octopus, or non-Agile products.
- Per-user scheduling at exactly 16:00 (not possible with polling).
- User-entered reference price override.

## Open items to confirm during implementation

- Framework class hook for bit-depth scoped CSS inside the template.
- Whether trmnlp's `serve` offers a TRMNL X preview; if not, use `build`.
- Behaviour of the API's inc-VAT field after 1 October 2026.
