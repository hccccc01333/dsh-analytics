/**
 * dsh-analytics: Agent FinOps / token analytics for DeepSeek Harness.
 *
 * The plugin collects token usage from session events into a SQLite ledger,
 * prices it with a time-aware pricing table (never hardcoded in logic),
 * exposes `ctx.analytics` queries, an `analytics_query` agent tool, and JSON
 * API routes behind `ctx.webServer`.
 *
 * @module dsh-analytics
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { AnalyticsLocal } from './analytics.ts'
import { UsageCollector } from './collector.ts'
import { Config, resolvePricingRows, validateConfig } from './config.ts'
import { DEFAULT_PEAK_HOURS, PricingEngine } from './pricing.ts'
import { AnalyticsStore } from './store.ts'
import { registerAnalyticsTool } from './tool.ts'
import type { AnalyticsConfig } from './types.ts'
import { registerAnalyticsRoutes } from './web.ts'

export { Config } from './config.ts'
export { PricingEngine } from './pricing.ts'
export { AnalyticsStore } from './store.ts'
export { UsageCollector } from './collector.ts'
export type * from './types.ts'
export type * from './analytics.ts'

/** Cordis plugin name. */
export const name = 'analytics'

/**
 * Plugin entry: open the store, seed pricing, mount collection, the
 * analytics service, the agent tool, and the optional web routes.
 *
 * @param ctx - plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: AnalyticsConfig): void {
  validateConfig(config)

  const store = new AnalyticsStore(config.dbPath)
  ctx.effect(() => () => store.close())

  const engine = new PricingEngine(resolvePricingRows(config, store), config.peakHours ?? DEFAULT_PEAK_HOURS)
  const collector = new UsageCollector(store)

  ctx.on('session/created', (session) => {
    collector.observeSession(session.id, session.header)
  })
  ctx.on('session/event', (session, event) => {
    collector.observeEvent(session.id, event)
  })

  // Backfill persisted sessions when the session-query seam is mounted;
  // without it the collector stays live-only.
  ctx.inject(['sessionQuery'], (queryCtx) => {
    void backfill(queryCtx.sessionQuery, collector, queryCtx.logger)
  })

  ctx.plugin(AnalyticsLocal, {
    store,
    engine,
    ...(config.budget === undefined ? {} : { budget: config.budget }),
    ...(config.currency === undefined ? {} : { currency: config.currency }),
  })

  if (config.tools !== false) {
    ctx.inject(['tools'], (toolsCtx) => {
      registerAnalyticsTool(toolsCtx)
    })
  }
  if (config.web !== false) {
    ctx.inject(['webServer'], (webCtx) => {
      registerAnalyticsRoutes(webCtx, webCtx.analytics)
    })
  }
}

/**
 * Replay all logical sessions into the ledger. Live appends observed while
 * the replay runs are idempotent upserts, so interleaving is safe.
 *
 * @param query - the mounted session-query engine.
 * @param collector - collector that folds each session's log.
 * @param logger - cordis logger for per-session failures.
 */
async function backfill(
  query: SessionQueryEngine,
  collector: UsageCollector,
  logger: Context['logger'],
): Promise<void> {
  const records = await query.listSessions()
  for (const record of records) {
    const header = record.header
    try {
      const snapshot = await query.readSession(header.id)
      collector.backfill(
        snapshot.session.id,
        snapshot.session.createdAt,
        snapshot.events,
        {
          ...(snapshot.session.cwd === undefined ? {} : { cwd: snapshot.session.cwd }),
          ...(snapshot.session.parentSession === undefined ? {} : { parentSession: snapshot.session.parentSession }),
        },
      )
    } catch (error) {
      // A corrupt or unreadable session must not block the rest of the
      // corpus; that session simply stays live-only for this process.
      logger.warn(`analytics: backfill skipped session ${header.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
