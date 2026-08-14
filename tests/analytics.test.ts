import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { AnalyticsLocal } from '../src/analytics.ts'
import { DEFAULT_PRICING, DEEPSEEK_V4_PEAK_START } from '../src/default-pricing.ts'
import { PricingEngine } from '../src/pricing.ts'
import { AnalyticsStore } from '../src/store.ts'
import type { PricingRow, UsageRecord } from '../src/types.ts'

const T0 = Date.parse('2026-08-01T10:00:00Z')

function record(partial: Partial<UsageRecord> & { sessionId: string; seq: number }): UsageRecord {
  return {
    turn: 1,
    step: 1,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    time: T0,
    inputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 500,
    reasoningTokens: 100,
    ...partial,
  }
}

async function mount(store: AnalyticsStore, budget?: { daily?: number; monthly?: number; currency?: string }): Promise<Context> {
  const ctx = new Context()
  const engine = new PricingEngine(DEFAULT_PRICING)
  await ctx.plugin(AnalyticsLocal, {
    store,
    engine,
    ...(budget === undefined ? {} : { budget }),
  })
  return ctx
}

test('overview aggregates totals, cost, cache, and reasoning', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.upsertSession({ sessionId: 'session-1', createdAt: T0, cwd: '/work' })
    store.upsertSession({ sessionId: 'session-2', createdAt: T0 + 3_600_000 })
    store.upsertRequest(record({ sessionId: 'session-1', seq: 1, time: T0, inputTokens: 1000, cacheReadTokens: 2000, outputTokens: 500, reasoningTokens: 100 }))
    store.upsertRequest(record({ sessionId: 'session-2', seq: 2, time: T0 + 3_600_000, model: 'deepseek-v4-flash', inputTokens: 100, outputTokens: 50 }))
    store.upsertToolCall({ sessionId: 'session-1', turn: 1, step: 1, seq: 3, callId: 'c1', name: 'web_search', time: T0 + 1000 })
    store.pairToolResult({ sessionId: 'session-1', callId: 'c1', resultSeq: 4, isError: false })

    const ctx = await mount(store)
    const overview = await ctx.analytics.overview({ start: T0 - 1, end: T0 + 7_200_000 })

    assert.equal(overview.totals.apiCalls, 2)
    assert.equal(overview.totals.sessions, 2)
    assert.equal(overview.totals.toolCalls, 1)
    assert.equal(overview.totals.inputTokens, 1100)
    assert.equal(overview.totals.cacheReadTokens, 2000)
    assert.equal(overview.totals.outputTokens, 550)
    assert.equal(overview.totals.reasoningTokens, 200)
    assert.equal(overview.totals.totalTokens, 3650)
    assert.equal(overview.totals.unpricedCalls, 0)
    assert.equal(overview.cache.hitRate, 2000 / (2000 + 1000 + 100))
    assert.equal(overview.reasoning.shareOfOutput, 200 / 550)
    assert.equal(overview.cost.length, 1)
    assert.equal(overview.cost[0]?.currency, 'USD')
    assert.ok(overview.cost[0]!.amount > 0)
    assert.equal(overview.byModel.length, 2)
    assert.equal(overview.bySession.length, 2)
    assert.ok(overview.trend.length >= 2)
  } finally {
    store.close()
  }
})

test('session drill-down returns requests, turns, and tools', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.upsertSession({ sessionId: 'session-1', createdAt: T0, cwd: '/work' })
    store.upsertRequest(record({ sessionId: 'session-1', seq: 1, turn: 1, time: T0, inputTokens: 1000, outputTokens: 500 }))
    store.upsertRequest(record({ sessionId: 'session-1', seq: 2, turn: 2, time: T0 + 60_000, inputTokens: 2000, outputTokens: 600 }))
    store.upsertToolCall({ sessionId: 'session-1', turn: 1, step: 1, seq: 3, callId: 'c1', name: 'web_search', time: T0 + 1000 })
    store.pairToolResult({ sessionId: 'session-1', callId: 'c1', resultSeq: 4, isError: true })

    const ctx = await mount(store)
    const detail = await ctx.analytics.session('session-1')

    assert.equal(detail.requests.length, 2)
    assert.equal(detail.turns.length, 2)
    assert.equal(detail.turns[0]?.turn, 1)
    assert.equal(detail.turns[1]?.turn, 2)
    assert.equal(detail.tools.length, 1)
    assert.equal(detail.tools[0]?.name, 'web_search')
    assert.equal(detail.tools[0]?.errors, 1)
    assert.equal(detail.tools[0]?.successRate, 0)
    assert.equal(detail.tools[0]?.apiCalls, 1)
    assert.equal(detail.cache.hitRate, 0)
  } finally {
    store.close()
  }
})

test('reasoning aggregates effort efficiency with turn stats', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.upsertSession({ sessionId: 'session-1', createdAt: T0 })
    store.upsertRequest(record({ sessionId: 'session-1', seq: 1, turn: 1, reasoningEffort: 'high', time: T0, inputTokens: 1000, outputTokens: 500, reasoningTokens: 200 }))
    store.upsertRequest(record({ sessionId: 'session-1', seq: 2, turn: 2, reasoningEffort: 'max', time: T0 + 60_000, inputTokens: 2000, outputTokens: 600, reasoningTokens: 400 }))
    store.upsertTurnStart({ sessionId: 'session-1', turn: 1, startTime: T0 })
    store.upsertTurnEnd({ sessionId: 'session-1', turn: 1, endTime: T0 + 20_000, reason: 'completed' })
    store.upsertTurnStart({ sessionId: 'session-1', turn: 2, startTime: T0 + 60_000 })
    store.upsertTurnEnd({ sessionId: 'session-1', turn: 2, endTime: T0 + 90_000, reason: 'error' })

    const ctx = await mount(store)
    const rows = await ctx.analytics.reasoning({ start: T0 - 1, end: T0 + 200_000 })
    assert.equal(rows.length, 2)
    const high = rows.find(row => row.reasoningEffort === 'high')
    const max = rows.find(row => row.reasoningEffort === 'max')
    assert.ok(high !== undefined)
    assert.equal(high.turns, 1)
    assert.equal(high.completedTurns, 1)
    assert.equal(high.successRate, 1)
    assert.equal(high.avgDurationMs, 20_000)
    assert.ok(high.costPerSuccess.length > 0)
    assert.ok(max !== undefined)
    assert.equal(max.turns, 1)
    assert.equal(max.completedTurns, 0)
    assert.equal(max.successRate, 0)
    assert.equal(max.avgDurationMs, 30_000)
    assert.equal(max.costPerSuccess.length, 0)
  } finally {
    store.close()
  }
})

test('session turns carry duration and success from turn records', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.upsertSession({ sessionId: 'session-1', createdAt: T0 })
    store.upsertRequest(record({ sessionId: 'session-1', seq: 1, turn: 1, time: T0, inputTokens: 100, outputTokens: 50 }))
    store.upsertTurnStart({ sessionId: 'session-1', turn: 1, startTime: T0 })
    store.upsertTurnEnd({ sessionId: 'session-1', turn: 1, endTime: T0 + 5000, reason: 'completed' })
    const ctx = await mount(store)
    const detail = await ctx.analytics.session('session-1')
    assert.equal(detail.turns[0]?.durationMs, 5000)
    assert.equal(detail.turns[0]?.success, true)
  } finally {
    store.close()
  }
})

test('agents builds the parent/child cost tree', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.upsertSession({ sessionId: 'main', createdAt: T0, title: 'main agent' })
    store.upsertSession({ sessionId: 'sub-search', createdAt: T0 + 1000, parentSession: 'main' })
    store.upsertSession({ sessionId: 'sub-review', createdAt: T0 + 2000, parentSession: 'main' })
    store.upsertRequest(record({ sessionId: 'main', seq: 1, time: T0, inputTokens: 1000, outputTokens: 500 }))
    store.upsertRequest(record({ sessionId: 'sub-search', seq: 2, time: T0 + 1000, model: 'deepseek-v4-flash', inputTokens: 200, outputTokens: 100 }))
    store.upsertRequest(record({ sessionId: 'sub-review', seq: 3, time: T0 + 2000, inputTokens: 400, outputTokens: 200 }))
    const ctx = await mount(store)
    const roots = await ctx.analytics.agents({ start: T0 - 1, end: T0 + 5000 })
    assert.equal(roots.length, 1)
    assert.equal(roots[0]?.sessionId, 'main')
    assert.equal(roots[0]?.children.length, 2)
    assert.equal(roots[0]?.children[0]?.sessionId, 'sub-review')
  } finally {
    store.close()
  }
})

test('insights emits cache-low and reasoning-effort rules', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.upsertSession({ sessionId: 'session-1', createdAt: T0 })
    store.upsertRequest(record({ sessionId: 'session-1', seq: 1, turn: 1, reasoningEffort: 'high', time: T0, inputTokens: 1000, outputTokens: 500, reasoningTokens: 100 }))
    store.upsertRequest(record({ sessionId: 'session-1', seq: 2, turn: 2, reasoningEffort: 'max', time: T0 + 60_000, inputTokens: 2000, outputTokens: 600, reasoningTokens: 200 }))
    store.upsertTurnStart({ sessionId: 'session-1', turn: 1, startTime: T0 })
    store.upsertTurnEnd({ sessionId: 'session-1', turn: 1, endTime: T0 + 10_000, reason: 'completed' })
    store.upsertTurnStart({ sessionId: 'session-1', turn: 2, startTime: T0 + 60_000 })
    store.upsertTurnEnd({ sessionId: 'session-1', turn: 2, endTime: T0 + 120_000, reason: 'completed' })
    const ctx = await mount(store)
    const insights = await ctx.analytics.insights({ start: T0 - 1, end: T0 + 200_000 })
    assert.ok(insights.some(insight => insight.kind === 'cache-low'))
    assert.ok(insights.some(insight => insight.kind === 'reasoning-effort'))
  } finally {
    store.close()
  }
})

test('budget reports daily and monthly spend with projection', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.upsertSession({ sessionId: 'session-1', createdAt: T0 })
    store.upsertRequest(record({ sessionId: 'session-1', seq: 1, time: T0, inputTokens: 1_000_000, outputTokens: 0 }))
    const ctx = await mount(store, { daily: 10, monthly: 100, currency: 'USD' })
    const budget = await ctx.analytics.budget({ now: T0 + 3_600_000 })
    assert.ok(budget.daily !== undefined)
    assert.ok(Math.abs(budget.daily.spent - 0.435) < 1e-9)
    assert.equal(budget.daily.currency, 'USD')
    assert.equal(budget.monthly?.currency, 'USD')
    assert.ok(budget.monthly!.projected > budget.monthly!.spent)
  } finally {
    store.close()
  }
})

test('pricing returns the seeded table', async () => {
  const store = new AnalyticsStore(':memory:')
  try {
    store.seedPricing(DEFAULT_PRICING, false)
    const ctx = await mount(store)
    const rows = await ctx.analytics.pricing()
    assert.ok(rows.length >= 18)
    const boundary = rows.find(row => row.model === 'deepseek-v4-pro'
      && row.priceType === 'peak'
      && row.inputType === 'output'
      && row.effectiveFrom === DEEPSEEK_V4_PEAK_START)
    assert.ok(boundary !== undefined)
    assert.equal(boundary.pricePerMillion, 3.96)
    const flat = rows.find((row: PricingRow) => row.model === 'deepseek-v4-pro' && row.priceType === 'flat' && row.inputType === 'output')
    assert.equal(flat?.effectiveTo, DEEPSEEK_V4_PEAK_START)
  } finally {
    store.close()
  }
})
