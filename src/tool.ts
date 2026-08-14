/**
 * Model-facing `analytics_query` tool.
 *
 * The agent can ask for the same numbers the dashboards will show: overview,
 * session drill-down, per-model, per-tool, pricing, and budget. Everything is
 * a read over the analytics store; the tool never touches the session log.
 *
 * @module dsh-analytics/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const QUERIES = ['overview', 'session', 'sessions', 'models', 'tools', 'reasoning', 'agents', 'insights', 'pricing', 'budget'] as const

/** Tool arguments after registry validation. */
interface AnalyticsQueryArgs {
  query?: string
  range_hours?: number
  session_id?: string
}

/** Register the analytics query tool on a tools context. */
export function registerAnalyticsTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'analytics_query',
    description:
      'Query token usage and cost analytics for the local harness. '
      + '`query` selects the report: overview (totals, trend, cost by model/session), '
      + 'session (one session\'s turn waterfall and cache), sessions/models/tools (aggregates over a range), '
      + 'pricing (the pricing table in force), or budget (spend vs configured limits). '
      + '`range_hours` bounds the report window (0 = all time, default 24); '
      + '`session_id` is required for the session query.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        enum: [...QUERIES],
        description: 'Which analytics report to run.',
      },
      range_hours: {
        type: 'number',
        description: 'Report window in hours ending now; 0 means all time (default 24).',
      },
      session_id: {
        type: 'string',
        description: 'Session id for the session drill-down query.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args: AnalyticsQueryArgs) {
      const query = args.query ?? 'overview'
      const range = rangeFromHours(args.range_hours)
      let result: unknown
      switch (query) {
        case 'overview':
          result = await ctx.analytics.overview(range)
          break
        case 'session': {
          if (args.session_id === undefined || args.session_id.trim() === '') {
            throw new Error('analytics_query: session query requires `session_id`')
          }
          result = await ctx.analytics.session(args.session_id.trim())
          break
        }
        case 'sessions':
          result = await ctx.analytics.sessions(range)
          break
        case 'models':
          result = await ctx.analytics.models(range)
          break
        case 'tools':
          result = await ctx.analytics.tools(range)
          break
        case 'reasoning':
          result = await ctx.analytics.reasoning(range)
          break
        case 'agents':
          result = await ctx.analytics.agents(range)
          break
        case 'insights':
          result = await ctx.analytics.insights(range)
          break
        case 'pricing':
          result = await ctx.analytics.pricing()
          break
        case 'budget':
          result = await ctx.analytics.budget()
          break
        default:
          throw new Error(`analytics_query: unknown query ${JSON.stringify(query)}`)
      }
      return { text: JSON.stringify(result, null, 2) }
    },
  }))
}

function rangeFromHours(hours: number | undefined): { start?: number; end?: number } | undefined {
  if (hours === undefined || hours === 0) return undefined
  if (hours < 0) throw new Error('analytics_query: range_hours must be non-negative')
  return { start: Date.now() - hours * 3_600_000 }
}
