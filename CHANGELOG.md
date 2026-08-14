# Changelog

## 0.2.0 — 2026-08-14

- Turn-level data: `turn/start` / `turn/end` are folded into a turns ledger (duration + outcome); session drill-down turns now show duration and success.
- Reasoning efficiency: new `ctx.analytics.reasoning()`, `/api/analytics/reasoning` route, `analytics_query(query="reasoning")`, and a Reasoning dashboard page (per-effort calls, success rate, avg duration, cost, cost per success with charts).
- Per-turn cost in the harness chat: the client bundle registers a `conversation.chat.turnTail` entry rendering "tokens · cost · duration" under each closed turn's final message.

## 0.1.6 — 2026-08-14

- Chart legends move into the chart's top-right corner as a translucent overlay (Token Trend, Token Flow, Cost Trend, Cumulative Context, and Pricing comparison charts).

## 0.1.5 — 2026-08-14

- Line charts: visible axes (left + bottom), tick marks, gradient area fills, smooth curves, data-point dots on sparse series, and a hover tooltip with a guide line.
- More visualizations: token-composition and cost-by-model donut charts, cache hit-rate trend line on Overview, per-turn cost bars on session detail, and a latest-rate price comparison bar chart on the Pricing page.

## 0.1.4 — 2026-08-14

- Breathing-room pass: wider page/padding/gaps, roomier KPI cards and tables, bigger chart, and a single combined trend panel on Overview (the separate Cost Trend panel moved to the Cost page only).
- In-app client panel: same spacing treatment (padding, KPI cards, tables, toolbar).

## 0.1.3 — 2026-08-14

- Remove the bottom-left footer line from the dashboard (it read as clutter/overlap in the corner).
- Charts: wider left gutter and ~80px minimum x-label spacing; verified clean at 1500 / 1024 / 720 / 640 in both languages.

## 0.1.2 — 2026-08-14

- i18n: the standalone dashboard now has an EN/中文 toggle (persisted, `?lang=` param), with every label translated.
- Fix: chart x-labels are evenly spaced including both ends (~70px minimum) and the first/last anchor away from the y-axis and chart edge.
- QA: multi-viewport (1500 / 1024 / 720) overlap, label-collision, and overflow checks pass in both languages.

## 0.1.1 — 2026-08-14

- Polish: thin chart x-labels to ~64px minimum spacing so 7d/30d ranges never collide.
- Polish: ellipsize long metric labels/values and session titles; widen cost value cells.
- Fix: preview script seeds the pricing table so the Pricing page renders.
- Add: `scripts/visual-qa.mjs` — headless overlap / text-overflow / font-size QA over the preview server.

## 0.1.0 — 2026-08-14

- Initial release: usage collector over `session/event` with SQLite persistence and replay backfill through `ctx.sessionQuery`.
- Time-aware cost engine: `pricing_table`-style rows with `effective_from`/`effective_to`, peak/off-peak windows, and cache-hit/miss/write buckets; no prices hardcoded in logic.
- Analytics service `ctx.analytics` with overview, session drill-down (turn waterfall + cumulative context), model, tool, cache, and budget queries.
- `analytics_query` agent tool, JSON API routes, and a browser dashboard (`/analytics`: Overview / Sessions / Token Flow / Models / Cost / Pricing) behind `ctx.webServer`.
- Browser client bundle: a sidebar-foot Token Analytics entry opening a full-screen in-app dashboard (Overview / Sessions / Token Flow / Models / Cost / Pricing), plus a per-session Analytics action opening the task-cost overlay (harness module-loader contract, CSS Modules inlined).
