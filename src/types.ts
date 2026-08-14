/**
 * Public vocabulary of the dsh-analytics plugin: configuration, pricing rows,
 * and the stored usage records.
 *
 * @module dsh-analytics/types
 */

/** One billable token bucket of a provider model call. */
export type PricingInputType = 'cache_hit' | 'cache_miss' | 'cache_write' | 'output'

/** Whether a price applies to peak hours, off-peak hours, or any hour. */
export type PricingWindow = 'peak' | 'off-peak' | 'flat'

/**
 * One price table row; prices are per one million tokens in `currency`.
 * `effectiveFrom` is inclusive and `effectiveTo` exclusive, so historical
 * bills never change when a provider reprices: a request at time T always
 * matches the rows that were in force at T.
 */
export interface PricingRow {
  /** Provider route key, matching `request/header` config provider. */
  provider: string
  /** Provider model id, matching `request/header` config model. */
  model: string
  /** Optional region discriminator; absent rows match every region. */
  region?: string
  /** Hour-of-day window the price applies to. */
  priceType: PricingWindow
  /** Token bucket the price applies to. */
  inputType: PricingInputType
  /** Price in `currency` per one million tokens. */
  pricePerMillion: number
  /** ISO 4217 currency code of `pricePerMillion`. */
  currency: string
  /** ISO 8601 instant when the row starts applying (inclusive). */
  effectiveFrom: string
  /** ISO 8601 instant when the row stops applying (exclusive). */
  effectiveTo?: string
}

/** One priced model call as collected from an `assistant/message` event. */
export interface UsageRecord {
  sessionId: string
  turn: number
  step: number
  /** Durable session-log seq of the `assistant/message` event; dedupe key. */
  seq: number
  /** Provider route key from the latest `request/header`, empty when unknown. */
  provider: string
  /** Provider model id from the latest `request/header`, empty when unknown. */
  model: string
  /** Reasoning effort of the request header, when recorded. */
  reasoningEffort?: string
  /** Event time, Unix epoch milliseconds. */
  time: number
  /** Uncached input tokens. */
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  /** Reasoning tokens (a subset of output tokens for DeepSeek V4). */
  reasoningTokens: number
}

/** One model-requested tool invocation with its optional result. */
export interface ToolCallRecord {
  sessionId: string
  turn: number
  step: number
  /** Durable session-log seq of the `tool/call` event; dedupe key. */
  seq: number
  callId: string
  name: string
  /** Event time, Unix epoch milliseconds. */
  time: number
  /** Seq of the paired `tool/result` event, absent while pending. */
  resultSeq?: number
  /** Whether the result reported an error. */
  isError?: boolean
}

/** One agent turn with its wall-clock span and outcome. */
export interface TurnRecord {
  sessionId: string
  turn: number
  /** `turn/start` event time, Unix epoch milliseconds. */
  startTime: number
  /** `turn/end` event time, absent while the turn is open. */
  endTime?: number
  /** `endTime - startTime`, absent until the turn closes. */
  durationMs?: number
  /** `turn/end` reason kind (`completed`, `error`, `aborted`, ...). */
  reason?: string
}

/** Plugin configuration; see the README for the full reference. */
export interface AnalyticsConfig {
  /** Filesystem path of the analytics SQLite database file. */
  dbPath: string
  /** Preferred currency shown first in summaries, when present in the table. */
  currency?: string
  /** UTC half-open `[startHour, endHour)` peak windows (validated at load). */
  peakHours?: number[][]
  /** Pricing rows that replace the shipped defaults. */
  pricing?: PricingRow[]
  /** Path to a JSON file of pricing rows that replace the shipped defaults. */
  pricingFile?: string
  /** Optional daily/monthly spending limits. */
  budget?: {
    daily?: number
    monthly?: number
    currency?: string
  }
  /** Whether the `analytics_query` agent tool is registered. */
  tools?: boolean
  /** Whether the `/api/analytics/*` JSON routes are registered. */
  web?: boolean
}
