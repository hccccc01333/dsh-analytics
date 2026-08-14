# Changelog

## 0.1.0 — 2026-08-14

- Initial release: usage collector over `session/event` with SQLite persistence and replay backfill through `ctx.sessionQuery`.
- Time-aware cost engine: `pricing_table`-style rows with `effective_from`/`effective_to`, peak/off-peak windows, and cache-hit/miss/write buckets; no prices hardcoded in logic.
- Analytics service `ctx.analytics` with overview, session drill-down (turn waterfall + cumulative context), model, tool, cache, and budget queries.
- `analytics_query` agent tool, JSON API routes, and a browser dashboard (`/analytics`: Overview / Sessions / Token Flow / Models / Cost / Pricing) behind `ctx.webServer`.
- Browser client bundle: a sidebar-foot Token Analytics entry opening a full-screen in-app dashboard (Overview / Sessions / Token Flow / Models / Cost / Pricing), plus a per-session Analytics action opening the task-cost overlay (harness module-loader contract, CSS Modules inlined).
