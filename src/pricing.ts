/**
 * Time-aware cost engine over a pricing table.
 *
 * Prices are never hardcoded in logic: {@link PricingEngine} matches rows by
 * provider/model, token bucket, hour window, and the `effective_from` /
 * `effective_to` instant range, so a request at time T is always billed with
 * the rows in force at T and later repricing never rewrites history.
 *
 * @module dsh-analytics/pricing
 */

import type { PricingInputType, PricingRow, UsageRecord } from './types.ts'

/** One price lookup. */
export interface PriceMatch {
  provider: string
  model: string
  /** Request time, Unix epoch milliseconds; decides peak window and pricing era. */
  time: number
  inputType: PricingInputType
}

/** Resolved price of one bucket. */
export interface ResolvedPrice {
  /** Price in `currency` per one million tokens. */
  pricePerMillion: number
  currency: string
}

/** Computed cost of one usage record. */
export interface ComputedCost {
  cost: number
  currency: string
  /** False when at least one non-empty bucket had no matching price row. */
  priced: boolean
}

/** Default UTC peak windows: 01:00–04:00 and 06:00–10:00. */
export const DEFAULT_PEAK_HOURS: readonly (readonly [number, number])[] = [[1, 4], [6, 10]]

/** Engine-local row with its parsed effective instant for ordering. */
interface IndexedRow {
  row: PricingRow
  from: number
  to?: number
}

/**
 * Resolve the current price of one token bucket from a pricing table.
 */
export class PricingEngine {
  /** The exact peak windows configured for this deployment. */
  readonly peakHours: readonly (readonly number[])[]

  private readonly rows: readonly IndexedRow[]

  /**
   * @param rows - pricing table rows; caller keeps ownership, the engine copies references.
   * @param peakHours - UTC half-open `[startHour, endHour)` peak windows; defaults to DeepSeek's.
   */
  constructor(rows: readonly PricingRow[], peakHours: readonly (readonly number[])[] = DEFAULT_PEAK_HOURS) {
    for (const window of peakHours) {
      const start = window[0]
      const end = window[1]
      if (start === undefined || end === undefined
        || !Number.isInteger(start) || !Number.isInteger(end)
        || start < 0 || end > 24 || start >= end) {
        throw new Error(`pricing engine: peak window ${JSON.stringify(window)} must be a [startHour, endHour) pair with 0 <= start < end <= 24`)
      }
    }
    this.rows = rows.map((row) => {
      const from = Date.parse(row.effectiveFrom)
      if (!Number.isFinite(from)) {
        throw new Error(`pricing row for ${row.provider}/${row.model} has invalid effectiveFrom ${JSON.stringify(row.effectiveFrom)}`)
      }
      const to = row.effectiveTo === undefined ? undefined : Date.parse(row.effectiveTo)
      if (to !== undefined && !Number.isFinite(to)) {
        throw new Error(`pricing row for ${row.provider}/${row.model} has invalid effectiveTo ${JSON.stringify(row.effectiveTo)}`)
      }
      return { row, from, to }
    })
    this.peakHours = peakHours
  }

  /** Whether `time` falls inside a configured peak window (UTC hours). */
  isPeak(time: number): boolean {
    const hour = new Date(time).getUTCHours()
    return this.peakHours.some((window) => {
      const start = window[0]
      const end = window[1]
      return start !== undefined && end !== undefined && hour >= start && hour < end
    })
  }

  /**
   * Resolve the price of one bucket at one instant.
   *
   * A `cache_write` bucket falls back to the `cache_miss` price when no
   * `cache_write` row exists (DeepSeek's table bills cache writes at the
   * cache-miss rate). Among matching rows the row with the latest
   * `effectiveFrom` wins, so a repricing supersedes the previous era exactly
   * at its effective instant.
   *
   * @param match - provider, model, instant, and bucket to price.
   * @returns the resolved price and currency, or undefined when unpriced.
   */
  resolvePrice(match: PriceMatch): ResolvedPrice | undefined {
    const window = this.isPeak(match.time) ? 'peak' : 'off-peak'
    let best: IndexedRow | undefined
    for (const indexed of this.rows) {
      const { row } = indexed
      if (row.provider !== match.provider || row.model !== match.model) continue
      if (row.inputType !== match.inputType) {
        const fallback = match.inputType === 'cache_write' && row.inputType === 'cache_miss'
        if (!fallback) continue
      }
      if (row.priceType !== 'flat' && row.priceType !== window) continue
      if (match.time < indexed.from) continue
      if (indexed.to !== undefined && match.time >= indexed.to) continue
      if (best === undefined || indexed.from > best.from) best = indexed
    }
    return best === undefined
      ? undefined
      : { pricePerMillion: best.row.pricePerMillion, currency: best.row.currency }
  }

  /**
   * Compute the total cost of one usage record at its recorded instant.
   *
   * Buckets with no matching row contribute zero and mark the result
   * `priced: false` (exposed as `unpricedCalls` in aggregates). The currency
   * of the output bucket wins when it is priced, otherwise the first priced
   * bucket's currency; mixed-currency tables are unsupported.
   *
   * @param record - collected usage for one model call.
   * @returns the cost, or undefined when every bucket is empty or unpriced.
   */
  costFor(record: UsageRecord): ComputedCost | undefined {
    const buckets: { inputType: PricingInputType; tokens: number }[] = [
      { inputType: 'cache_miss', tokens: record.inputTokens },
      { inputType: 'cache_hit', tokens: record.cacheReadTokens },
      { inputType: 'cache_write', tokens: record.cacheWriteTokens },
      { inputType: 'output', tokens: record.outputTokens },
    ]
    let cost = 0
    let priced = true
    let sawBucket = false
    let outputCurrency: string | undefined
    let firstCurrency: string | undefined
    for (const bucket of buckets) {
      if (bucket.tokens <= 0) continue
      sawBucket = true
      const price = this.resolvePrice({
        provider: record.provider,
        model: record.model,
        time: record.time,
        inputType: bucket.inputType,
      })
      if (price === undefined) {
        priced = false
        continue
      }
      cost += price.pricePerMillion * bucket.tokens / 1e6
      firstCurrency ??= price.currency
      if (bucket.inputType === 'output') outputCurrency = price.currency
    }
    if (!sawBucket) return undefined
    const currency = outputCurrency ?? firstCurrency
    return currency === undefined ? undefined : { cost, currency, priced }
  }

  /**
   * Estimate what cache reads would have cost at the cache-miss rate.
   *
   * @param record - collected usage for one model call.
   * @returns the estimated miss-price cost of `cacheReadTokens`, or undefined when unpriced.
   */
  cacheSavingsFor(record: UsageRecord): ResolvedPrice | undefined {
    if (record.cacheReadTokens <= 0) return undefined
    const miss = this.resolvePrice({
      provider: record.provider,
      model: record.model,
      time: record.time,
      inputType: 'cache_miss',
    })
    const hit = this.resolvePrice({
      provider: record.provider,
      model: record.model,
      time: record.time,
      inputType: 'cache_hit',
    })
    if (miss === undefined || hit === undefined) return undefined
    return {
      pricePerMillion: (miss.pricePerMillion - hit.pricePerMillion) * record.cacheReadTokens / 1e6,
      currency: hit.currency,
    }
  }
}
