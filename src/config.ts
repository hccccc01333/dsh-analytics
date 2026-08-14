/**
 * Configuration schema and validation for the dsh-analytics plugin.
 *
 * The schema is intentionally permissive about shapes that need cross-field
 * checks (peak windows, pricing rows); {@link validateConfig} runs those
 * checks at load time so misconfiguration fails loud before any collection.
 *
 * @module dsh-analytics/config
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PRICING } from './default-pricing.ts'
import type { AnalyticsStore } from './store.ts'
import type { AnalyticsConfig, PricingRow, PricingWindow } from './types.ts'

const PRICING_WINDOWS: readonly PricingWindow[] = ['peak', 'off-peak', 'flat']

const pricingRowSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  region: z.string(),
  priceType: z.union([...PRICING_WINDOWS] as const).required(),
  inputType: z.union(['cache_hit', 'cache_miss', 'cache_write', 'output'] as const).required(),
  pricePerMillion: z.number().required(),
  currency: z.string().default('USD'),
  effectiveFrom: z.string().required(),
  effectiveTo: z.string(),
})

/** Schemastery configuration of the analytics plugin. */
export const Config: z<AnalyticsConfig> = z.object({
  dbPath: z.string().required(),
  currency: z.string(),
  peakHours: z.array(z.array(z.number())),
  pricing: z.array(pricingRowSchema),
  pricingFile: z.string(),
  budget: z.object({
    daily: z.number(),
    monthly: z.number(),
    currency: z.string(),
  }),
  tools: z.boolean().default(true),
  web: z.boolean().default(true),
})

/** Validate config keys the schema cannot express; throws on any violation. */
export function validateConfig(config: AnalyticsConfig): void {
  if (config.dbPath.trim() === '') {
    throw new Error('analytics: `dbPath` must be a non-empty path')
  }
  if (config.peakHours !== undefined) {
    for (const window of config.peakHours) {
      if (window.length !== 2
        || !Number.isInteger(window[0])
        || !Number.isInteger(window[1])
        || window[0] < 0
        || window[1] > 24
        || window[0] >= window[1]) {
        throw new Error(`analytics: peak window ${JSON.stringify(window)} must be a [startHour, endHour) pair with 0 <= start < end <= 24`)
      }
    }
  }
  if (config.pricing !== undefined && config.pricingFile !== undefined) {
    throw new Error('analytics: set either `pricing` rows or `pricingFile`, not both')
  }
  if (config.pricingFile !== undefined && !isAbsolute(config.pricingFile)) {
    throw new Error('analytics: `pricingFile` must be an absolute path')
  }
  if (config.budget !== undefined) {
    if (config.budget.daily !== undefined && config.budget.daily <= 0) {
      throw new Error('analytics: `budget.daily` must be positive')
    }
    if (config.budget.monthly !== undefined && config.budget.monthly <= 0) {
      throw new Error('analytics: `budget.monthly` must be positive')
    }
  }
}

function validatePricingRows(rows: readonly PricingRow[], source: string): void {
  if (rows.length === 0) {
    throw new Error(`analytics: pricing source ${source} contains no rows`)
  }
  for (const row of rows) {
    if (row.provider.trim() === '' || row.model.trim() === '') {
      throw new Error(`analytics: pricing row from ${source} has an empty provider or model`)
    }
    if (!Number.isFinite(row.pricePerMillion) || row.pricePerMillion < 0) {
      throw new Error(`analytics: pricing row for ${row.provider}/${row.model} has invalid pricePerMillion`)
    }
    if (!Number.isFinite(Date.parse(row.effectiveFrom))) {
      throw new Error(`analytics: pricing row for ${row.provider}/${row.model} has invalid effectiveFrom`)
    }
    if (row.effectiveTo !== undefined && !Number.isFinite(Date.parse(row.effectiveTo))) {
      throw new Error(`analytics: pricing row for ${row.provider}/${row.model} has invalid effectiveTo`)
    }
  }
}

/**
 * Resolve the pricing table for the engine and persist it to the store.
 *
 * Configuration rows (inline or from `pricingFile`) REPLACE the table so the
 * operator's table is authoritative; without configuration the shipped
 * defaults are seeded only when the table is empty, so previously recorded
 * prices survive a restart without a pricing config.
 *
 * @param config - validated plugin configuration.
 * @param store - store whose pricing table is seeded and read back.
 * @returns the effective pricing rows in force for cost computation.
 */
export function resolvePricingRows(config: AnalyticsConfig, store: AnalyticsStore): PricingRow[] {
  if (config.pricing !== undefined) {
    validatePricingRows(config.pricing, 'config.pricing')
    store.seedPricing(config.pricing, true)
  } else if (config.pricingFile !== undefined) {
    const loaded = JSON.parse(readFileSync(resolve(config.pricingFile), 'utf8')) as PricingRow[]
    validatePricingRows(loaded, config.pricingFile)
    store.seedPricing(loaded, true)
  } else {
    store.seedPricing(DEFAULT_PRICING, false)
  }
  const stored = store.loadPricing()
  if (stored.length === 0) {
    throw new Error('analytics: pricing table is empty; seed `pricing` rows or a `pricingFile`')
  }
  return stored
}
