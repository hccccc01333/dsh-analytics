# Changelog

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
