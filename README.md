# TRMNL Octopus Agile

A TRMNL e-ink plugin for the Octopus Agile electricity tariff. It shows the
price ahead as a bar chart against the Flexible Octopus variable tariff, the
current and next price, the cheapest and peak slots, and the cheapest windows
to run a washing machine and a dishwasher.

A Cloudflare Worker fetches and shapes the data; the TRMNL plugin polls it
every 15 minutes. Not an Octopus Energy product.

## Worker

Deployed at https://trmnl-octopus.tk.workers.dev (try
`/trmnl?region=C`).

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

`plugin/.trmnlp.yml` points the polling URL at the local Worker and can pin
the preview time with `at=`. Change `dev_query` there to see the morning,
evening or pending states.

Push to your TRMNL account with `trmnlp push` (after `trmnlp login`), or
zip `plugin/src/*` and import it as a private plugin.

## Design

See `docs/superpowers/specs/2026-09-09-trmnl-agile-design.md`.
