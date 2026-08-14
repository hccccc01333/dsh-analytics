# dsh-analytics

English | [中文](README.zh.md)

Agent FinOps / token analytics for DeepSeek Harness: collect usage from session
events into a local SQLite ledger, price it with a time-aware pricing table
(never hardcoded in logic), and query it through a service, an agent tool, and
JSON API routes.

This is the v1 scope from the design: **Overview + Session drill-down + Cost
Engine + Cache analytics**, packaged the way the dsh-plugin ecosystem ships
bundles (npm package with `dsh.bundle` → `cordis.patch.yml`).

## Install

```sh
dsh plugin --profile web add dsh-analytics
```

From git (requires the `prepare` build allowance):

```sh
dsh plugin --profile web add github:you/dsh-analytics#<sha>
```

From a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-analytics
```

For local development, mount the source overlay:

```sh
dsh --profile web --patch ./cordis.yml
```

## Configuration

The plugin row's `config` (see [cordis.yml](cordis.yml) for the shape):

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `dbPath` | string | — (required) | SQLite database file; missing directories are created. |
| `currency` | string | — | Preferred currency sorted first in summaries (rows carry their own currency). |
| `peakHours` | `[startHour, endHour][]` | `[[1,4],[6,10]]` | UTC half-open peak windows; all other hours are off-peak. |
| `pricing` | `PricingRow[]` | shipped DeepSeek V4 table | Pricing rows that **replace** the shipped defaults. |
| `pricingFile` | string (absolute) | — | JSON file of `PricingRow[]`; mutually exclusive with `pricing`. |
| `budget.daily` | number | — | Daily spending limit in `budget.currency` (UTC day). |
| `budget.monthly` | number | — | Monthly limit; the overview also projects month-end spend. |
| `budget.currency` | string | `currency` or `USD` | Currency the limits are measured in. |
| `tools` | boolean | `true` | Register the `analytics_query` agent tool. |
| `web` | boolean | `true` | Register the `/api/analytics/*` JSON routes when `ctx.webServer` exists. |

## Pricing: the table is data, not code

Costs are computed by matching each request against pricing rows:

```ts
interface PricingRow {
  provider: string          // request/header config provider
  model: string             // request/header config model
  region?: string           // optional discriminator
  priceType: 'peak' | 'off-peak' | 'flat'
  inputType: 'cache_hit' | 'cache_miss' | 'cache_write' | 'output'
  pricePerMillion: number   // per 1M tokens, in `currency`
  currency: string
  effectiveFrom: string     // ISO 8601, inclusive
  effectiveTo?: string      // ISO 8601, exclusive
}
```

The match uses `model + timestamp + cache hit/miss + input/output`, so a
request at time T is always billed with the rows in force at T — later
repricing never rewrites history. `cache_write` falls back to `cache_miss`
when no dedicated row exists. Among matching rows the one with the latest
`effectiveFrom` wins.

The shipped defaults follow DeepSeek's V4 announcement: flat rates until
`2026-08-16T16:00:00Z`, then peak/off-peak rates (off-peak = 50% of peak).
They are seed data only — supply `pricing` or `pricingFile` to own the table.
Without configuration, defaults are seeded only when the table is empty, so a
restart without a pricing config never overwrites recorded prices.

## What is collected

The plugin listens to `session/event` and replays persisted sessions through
`ctx.sessionQuery` on startup (live-only when the seam is absent):

- `assistant/message` usage → one request row per (session, seq)
  (deduplicated, replay-safe)
- `request/header` → provider / model / reasoning effort for pricing
- `tool/call` + `tool/result` → tool call rows with error flags
- session headers → created-at, cwd, parent for grouping

Storage is a local SQLite database (`dsh_analytics_requests`,
`dsh_analytics_tool_calls`, `dsh_analytics_sessions`,
`dsh_analytics_pricing`). Nothing leaves the machine; the plugin never calls
the provider API.

## Service: `ctx.analytics`

All reads are detached snapshots; the service never touches the session store
or the agent loop:

```ts
await ctx.analytics.overview({ start, end })   // totals, cost, cache, reasoning, trend, byModel, bySession, budget
await ctx.analytics.session(sessionId)          // request rows, turn waterfall, tools, cache
await ctx.analytics.sessions({ start, end })    // per-session summaries
await ctx.analytics.models({ start, end })      // per-provider/model summaries
await ctx.analytics.tools({ start, end })       // per-tool calls/errors + step-attributed cost
await ctx.analytics.pricing()                   // the pricing table in force
await ctx.analytics.budget()                    // spend vs configured limits + projection
```

Tool cost is **step-level attribution**: a model call's cost is distributed
evenly across the tools called in that step, so a step with several tools
shares its cost (never double counted).

## Agent tool: `analytics_query`

The model can ask for the same numbers:

```text
analytics_query(query="overview", range_hours=24)
analytics_query(query="session", session_id="session-1")
analytics_query(query="models" | "sessions" | "tools" | "pricing" | "budget", range_hours=24)
```

`range_hours` bounds the window ending now (`0` = all time, default 24).

## Web API

When `ctx.webServer` is mounted, read-only JSON routes register at
`/api/analytics/overview|sessions|models|tools|pricing|budget` (with an
optional `?hours=` query) and `/api/analytics/session/<sessionId>`. These are
the data source for a future dashboard page.

## Browser dashboard

The same routes power a self-contained dashboard served by the plugin at
`/analytics` (open the harness web server URL in any browser, or
`http://127.0.0.1:<port>/analytics` in a headless profile that mounts
`ctx.webServer`). It is a zero-build vanilla JS app shipped inside the
package (`web/`):

- **Overview** — KPI cards (cost, tokens, cache hit rate, reasoning share),
  token/cost trend, composition donut, cache hit-rate trend, cost by model, sessions, budget
- **Sessions** — list with drill-down: turn waterfall with duration/outcome,
  cumulative context chart, per-turn cost bars, tools, cache
- **Reasoning** — low/high/max efficiency: calls, success rate, avg duration,
  cost, and cost per success
- **Token Flow / Models / Cost / Pricing** — per-bucket trend, per-model
  aggregates, per-tool step attribution, latest-rate price comparison, and the pricing table

The range selector (6h/24h/7d/30d/all) applies to every page; the shell-nav
integration inside the harness client is a follow-up (the harness client has
no free plugin page slot today). The top bar also has an **EN / 中文** toggle
(persisted across visits; `?lang=zh` forces Chinese).

## In-shell entry (web profile)

The package also ships a browser client bundle (`dsh.client` →
`exports["./client"]`, built to the harness module-loader contract). In a web
profile it registers three entries:

- a **Token Analytics** action beside Settings at the sidebar foot, opening a
  full-screen in-app panel with the same six pages as `/analytics`
  (Overview / Sessions / Token Flow / Models / Cost / Pricing, with a range
  selector and refresh);
- a per-session **Analytics** action in the conversation header, opening the
  task-cost overlay (cost, tokens, cache hit rate, turn waterfall, tool
  attribution, and a link to the full dashboard);
- a per-turn cost line under each closed turn's final chat message
  ("tokens · cost · duration"), rendered by the `conversation.chat.turnTail` entry.

Both read the same read-only JSON routes, so they need the plugin's host half
(and its web routes) mounted. No harness client shell change is required:
the sidebar entry uses the shell's existing `sidebar.footer.action` hole.

## Development

```sh
pnpm install
pnpm test
pnpm lint
pnpm build
pnpm doctor
```

Visual QA: run `pnpm preview` in one terminal, then
`node scripts/visual-qa.mjs` — it drives headless Edge over the dashboard and
reports element overlaps, SVG chart-label collisions, text overflow, and the
font-size scale.

## Roadmap

- Analytics entry inside the harness client shell (left-nav integration; the
  client has no free plugin page slot today, so the dashboard currently lives
  at `/analytics`)
- Skill / sub-agent ROI and reasoning-effort efficiency
- Cost anomaly alerts from the budget signals

## License

MIT
