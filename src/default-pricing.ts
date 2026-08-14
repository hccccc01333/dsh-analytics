/**
 * Seed pricing rows shipped with the plugin. These are DATA, not logic: the
 * cost engine reads whatever rows configuration provides, and the table is
 * seeded from this file only when the database has no rows yet. Prices follow
 * DeepSeek's V4 announcement: flat prices until 16:00 UTC Aug 16 2026, then
 * peak/off-peak rates with off-peak at 50% of peak.
 *
 * @module dsh-analytics/default-pricing
 */

import type { PricingRow } from './types.ts'

/** Effective instant when DeepSeek's peak/off-peak pricing starts. */
export const DEEPSEEK_V4_PEAK_START = '2026-08-16T16:00:00Z'

/** Flat pre-change prices (before {@link DEEPSEEK_V4_PEAK_START}). */
export const DEFAULT_PRICING: readonly PricingRow[] = [
  // deepseek-v4-flash — flat rates in effect before 2026-08-16 16:00 UTC.
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'flat', inputType: 'cache_hit', pricePerMillion: 0.0028, currency: 'USD', effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'flat', inputType: 'cache_miss', pricePerMillion: 0.14, currency: 'USD', effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'flat', inputType: 'output', pricePerMillion: 0.28, currency: 'USD', effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: DEEPSEEK_V4_PEAK_START },
  // deepseek-v4-pro — flat rates in effect before 2026-08-16 16:00 UTC.
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'flat', inputType: 'cache_hit', pricePerMillion: 0.003625, currency: 'USD', effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'flat', inputType: 'cache_miss', pricePerMillion: 0.435, currency: 'USD', effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'flat', inputType: 'output', pricePerMillion: 0.87, currency: 'USD', effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: DEEPSEEK_V4_PEAK_START },
  // deepseek-v4-flash — peak rates from 2026-08-16 16:00 UTC.
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'peak', inputType: 'cache_hit', pricePerMillion: 0.014, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'peak', inputType: 'cache_miss', pricePerMillion: 0.44, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'peak', inputType: 'output', pricePerMillion: 1.32, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  // deepseek-v4-flash — off-peak rates from 2026-08-16 16:00 UTC (50% of peak).
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'off-peak', inputType: 'cache_hit', pricePerMillion: 0.007, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'off-peak', inputType: 'cache_miss', pricePerMillion: 0.22, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-flash', priceType: 'off-peak', inputType: 'output', pricePerMillion: 0.66, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  // deepseek-v4-pro — peak rates from 2026-08-16 16:00 UTC.
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'peak', inputType: 'cache_hit', pricePerMillion: 0.044, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'peak', inputType: 'cache_miss', pricePerMillion: 1.32, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'peak', inputType: 'output', pricePerMillion: 3.96, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  // deepseek-v4-pro — off-peak rates from 2026-08-16 16:00 UTC (50% of peak).
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'off-peak', inputType: 'cache_hit', pricePerMillion: 0.022, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'off-peak', inputType: 'cache_miss', pricePerMillion: 0.66, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
  { provider: 'deepseek', model: 'deepseek-v4-pro', priceType: 'off-peak', inputType: 'output', pricePerMillion: 1.98, currency: 'USD', effectiveFrom: DEEPSEEK_V4_PEAK_START },
]
