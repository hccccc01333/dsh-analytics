import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PRICING, DEEPSEEK_V4_PEAK_START } from '../src/default-pricing.ts'
import { DEFAULT_PEAK_HOURS, PricingEngine } from '../src/pricing.ts'
import type { UsageRecord } from '../src/types.ts'

const PRE = Date.parse('2026-08-01T10:00:00Z')
const POST_OFFPEAK = Date.parse('2026-08-20T12:00:00Z')
const POST_PEAK = Date.parse('2026-08-20T02:00:00Z')

const engine = new PricingEngine(DEFAULT_PRICING, DEFAULT_PEAK_HOURS)

test('flat pre-change prices apply before the peak/off-peak switch', () => {
  assert.equal(
    engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-pro', time: PRE, inputType: 'cache_miss' })?.pricePerMillion,
    0.435,
  )
  assert.equal(
    engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-flash', time: PRE, inputType: 'output' })?.pricePerMillion,
    0.28,
  )
})

test('peak/off-peak prices apply after the switch, off-peak at half of peak', () => {
  const peak = engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-pro', time: POST_PEAK, inputType: 'cache_miss' })
  const off = engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-pro', time: POST_OFFPEAK, inputType: 'cache_miss' })
  assert.equal(peak?.pricePerMillion, 1.32)
  assert.equal(off?.pricePerMillion, 0.66)
  assert.equal(engine.isPeak(POST_PEAK), true)
  assert.equal(engine.isPeak(POST_OFFPEAK), false)
})

test('the effective boundary is inclusive from and exclusive to', () => {
  const boundary = Date.parse(DEEPSEEK_V4_PEAK_START)
  // 16:00 UTC is an off-peak hour, so the new era's off-peak price applies.
  const atBoundary = engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-pro', time: boundary, inputType: 'output' })
  const nextPeakHour = Date.parse('2026-08-17T02:00:00Z')
  const inPeakEra = engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-pro', time: nextPeakHour, inputType: 'output' })
  const justBefore = engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-pro', time: boundary - 1, inputType: 'output' })
  assert.equal(atBoundary?.pricePerMillion, 1.98)
  assert.equal(inPeakEra?.pricePerMillion, 3.96)
  assert.equal(justBefore?.pricePerMillion, 0.87)
})

test('cache_write falls back to the cache_miss price', () => {
  const miss = engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-flash', time: PRE, inputType: 'cache_miss' })
  const write = engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v4-flash', time: PRE, inputType: 'cache_write' })
  assert.equal(write?.pricePerMillion, miss?.pricePerMillion)
})

test('unknown models and buckets stay unpriced', () => {
  assert.equal(engine.resolvePrice({ provider: 'deepseek', model: 'deepseek-v3', time: PRE, inputType: 'output' }), undefined)
  assert.equal(engine.resolvePrice({ provider: 'openai', model: 'deepseek-v4-pro', time: PRE, inputType: 'output' }), undefined)
})

test('costFor prices disjoint buckets at their own rates', () => {
  const record: UsageRecord = {
    sessionId: 'session-1',
    turn: 1,
    step: 1,
    seq: 10,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    time: PRE,
    inputTokens: 1000,
    cacheReadTokens: 2000,
    cacheWriteTokens: 0,
    outputTokens: 500,
    reasoningTokens: 100,
  }
  const cost = engine.costFor(record)
  assert.ok(cost !== undefined)
  assert.equal(cost.currency, 'USD')
  assert.equal(cost.priced, true)
  assert.ok(Math.abs(cost.cost - (1000 * 0.435 + 2000 * 0.003625 + 500 * 0.87) / 1e6) < 1e-12)
})

test('costFor marks a record unpriced when one bucket has no row', () => {
  const partial = new PricingEngine([
    { provider: 'deepseek', model: 'partial-model', priceType: 'flat', inputType: 'cache_miss', pricePerMillion: 1, currency: 'USD', effectiveFrom: '2020-01-01T00:00:00Z' },
  ])
  const record: UsageRecord = {
    sessionId: 'session-1',
    turn: 1,
    step: 1,
    seq: 11,
    provider: 'deepseek',
    model: 'partial-model',
    time: PRE,
    inputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 50,
    reasoningTokens: 0,
  }
  const cost = partial.costFor(record)
  assert.ok(cost !== undefined)
  assert.equal(cost.priced, false)
  assert.equal(cost.currency, 'USD')
  assert.ok(Math.abs(cost.cost - 100 / 1e6) < 1e-12)
})

test('cacheSavingsFor estimates the miss-vs-hit difference', () => {
  const record: UsageRecord = {
    sessionId: 'session-1',
    turn: 1,
    step: 1,
    seq: 12,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    time: PRE,
    inputTokens: 0,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
  const saving = engine.cacheSavingsFor(record)
  assert.ok(saving !== undefined)
  assert.ok(Math.abs(saving.pricePerMillion - (0.14 - 0.0028)) < 1e-12)
})
