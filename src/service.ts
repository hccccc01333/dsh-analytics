/**
 * Service definition of the analytics capability (`ctx.analytics`).
 *
 * @module dsh-analytics/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  AnalyticsOverview,
  AnalyticsRange,
  BudgetSummary,
  ModelSummary,
  SessionAnalytics,
  SessionSummary,
  ToolSummary,
} from './analytics.ts'
import type { PricingRow } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Usage, cost, and cache analytics over collected session events. */
    analytics: AnalyticsService
  }
}

/**
 * Service definition of the analytics capability.
 *
 * All reads are detached snapshots over the analytics SQLite store; they
 * never touch the session store or the agent loop.
 */
export abstract class AnalyticsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'analytics')
  }

  /**
   * Aggregate usage and cost over a time range.
   * @param request - optional `start`/`end` instants; omitted bounds are all-time and now.
   * @returns totals, cost, cache, reasoning, trend, per-model, and per-session summaries.
   */
  abstract overview(request?: AnalyticsRange): Promise<AnalyticsOverview>

  /**
   * Drill into one session: request-level rows, per-turn waterfall,
   * cumulative context, and tool attribution.
   * @param sessionId - the session to analyze.
   * @returns the session summary plus its requests, turns, and tools.
   */
  abstract session(sessionId: string): Promise<SessionAnalytics>

  /**
   * Per-session summaries over a time range.
   * @param request - optional time bounds.
   * @returns one summary per session, newest first.
   */
  abstract sessions(request?: AnalyticsRange): Promise<SessionSummary[]>

  /**
   * Per-provider-model summaries over a time range.
   * @param request - optional time bounds.
   * @returns one summary per provider/model, most expensive first.
   */
  abstract models(request?: AnalyticsRange): Promise<ModelSummary[]>

  /**
   * Per-tool summaries over a time range.
   * @param request - optional time bounds.
   * @returns one summary per tool name; cost is step-level attribution.
   */
  abstract tools(request?: AnalyticsRange): Promise<ToolSummary[]>

  /**
   * The pricing table currently in force for cost computation.
   * @returns all seeded pricing rows.
   */
  abstract pricing(): Promise<PricingRow[]>

  /**
   * Spending against configured daily/monthly limits.
   * @param request - optional `now` override for tests.
   * @returns configured limits with spent amounts, ratios, and monthly projection.
   */
  abstract budget(request?: { now?: number }): Promise<BudgetSummary>
}
