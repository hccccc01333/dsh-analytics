/**
 * Aggregation queries over the analytics store, plus the concrete service.
 *
 * @module dsh-analytics/analytics
 */

import type { Context } from '@deepseek-ai/cordis'
import { PricingEngine, type ComputedCost, type ResolvedPrice } from './pricing.ts'
import type { AnalyticsStore, SessionRow } from './store.ts'
import type { PricingRow, ToolCallRecord, UsageRecord } from './types.ts'
import { AnalyticsService } from './service.ts'

/** Optional half-open time bounds in Unix epoch milliseconds. */
export interface AnalyticsRange {
  start?: number
  end?: number
}

/** Summed token and call counters over one scope. */
export interface TokenTotals {
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  apiCalls: number
  /** Calls whose non-empty buckets are not fully covered by the pricing table. */
  unpricedCalls: number
  toolCalls: number
  sessions: number
}

/** Cost summed per currency. */
export interface CostSummary {
  currency: string
  amount: number
}

/** Cache traffic, hit rate, and estimated savings over one scope. */
export interface CacheSummary {
  cacheReadTokens: number
  uncachedInputTokens: number
  cacheWriteTokens: number
  /** Cache reads as a share of total billed input (reads + misses). */
  hitRate: number
  /** What cache reads would have cost at the miss price minus their actual price. */
  savings: CostSummary[]
}

/** One trend bucket of the overview chart. */
export interface TrendPoint {
  bucketStart: number
  apiCalls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  cost: CostSummary[]
}

/** Per-provider-model usage and cost. */
export interface ModelSummary {
  provider: string
  model: string
  apiCalls: number
  unpricedCalls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  cost: CostSummary[]
}

/** One session's aggregate usage and cost. */
export interface SessionSummary {
  sessionId: string
  cwd?: string
  title?: string
  parentSession?: string
  createdAt: number
  apiCalls: number
  unpricedCalls: number
  totalTokens: number
  cost: CostSummary[]
}

/** One model call as exposed by the session drill-down. */
export interface RequestView {
  turn: number
  step: number
  seq: number
  provider: string
  model: string
  reasoningEffort?: string
  time: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  /** Cost of this call; absent when every bucket was unpriced or empty. */
  cost?: CostSummary
}

/** One turn of a session, the unit of the cost waterfall. */
export interface TurnSummary {
  turn: number
  apiCalls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  cost: CostSummary[]
}

/** One tool's call counts and step-attributed usage. */
export interface ToolSummary {
  name: string
  calls: number
  errors: number
  successRate: number
  /** Model calls whose step contained this tool; cost attribution unit. */
  apiCalls: number
  totalTokens: number
  cost: CostSummary[]
}

/** Spending against configured limits. */
export interface BudgetSummary {
  daily?: {
    limit: number
    spent: number
    currency: string
    ratio: number
  }
  monthly?: {
    limit: number
    spent: number
    currency: string
    ratio: number
    /** Spent scaled by the month's elapsed share. */
    projected: number
  }
}

/** The overview page: totals, cost, cache, reasoning, trend, models, sessions. */
export interface AnalyticsOverview {
  range: { start: number; end: number }
  totals: TokenTotals
  cost: CostSummary[]
  cache: CacheSummary
  reasoning: {
    tokens: number
    shareOfOutput: number
    shareOfTotal: number
  }
  trend: TrendPoint[]
  byModel: ModelSummary[]
  bySession: SessionSummary[]
  budget?: BudgetSummary
}

/** Session drill-down: summary plus requests, turns, tools, and cache. */
export interface SessionAnalytics extends SessionSummary {
  requests: RequestView[]
  turns: TurnSummary[]
  tools: ToolSummary[]
  cache: CacheSummary
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

function startOfUtcDay(time: number): number {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function sumCosts(costs: Iterable<ComputedCost | undefined>): CostSummary[] {
  const byCurrency = new Map<string, number>()
  for (const cost of costs) {
    if (cost === undefined) continue
    byCurrency.set(cost.currency, (byCurrency.get(cost.currency) ?? 0) + cost.cost)
  }
  return [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount)
}

function sumResolved(costs: Iterable<ResolvedPrice | undefined>): CostSummary[] {
  const byCurrency = new Map<string, number>()
  for (const cost of costs) {
    if (cost === undefined) continue
    byCurrency.set(cost.currency, (byCurrency.get(cost.currency) ?? 0) + cost.pricePerMillion)
  }
  return [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount)
}

function cacheSummary(
  requests: readonly UsageRecord[],
  engine: PricingEngine,
): CacheSummary {
  let cacheRead = 0
  let uncached = 0
  let cacheWrite = 0
  const savings: ResolvedPrice[] = []
  for (const request of requests) {
    cacheRead += request.cacheReadTokens
    uncached += request.inputTokens
    cacheWrite += request.cacheWriteTokens
    const saving = engine.cacheSavingsFor(request)
    if (saving !== undefined) savings.push(saving)
  }
  const denominator = cacheRead + uncached
  return {
    cacheReadTokens: cacheRead,
    uncachedInputTokens: uncached,
    cacheWriteTokens: cacheWrite,
    hitRate: denominator === 0 ? 0 : cacheRead / denominator,
    savings: sumResolved(savings),
  }
}

interface CostedRequest {
  record: UsageRecord
  cost?: ComputedCost
}

function costRequests(
  records: readonly UsageRecord[],
  engine: PricingEngine,
): CostedRequest[] {
  return records.map((record) => ({ record, cost: engine.costFor(record) }))
}

function tokenTotals(costed: readonly CostedRequest[], toolCalls: number, sessions: number): TokenTotals {
  let input = 0
  let cacheRead = 0
  let cacheWrite = 0
  let output = 0
  let reasoning = 0
  let unpriced = 0
  for (const { record, cost } of costed) {
    input += record.inputTokens
    cacheRead += record.cacheReadTokens
    cacheWrite += record.cacheWriteTokens
    output += record.outputTokens
    reasoning += record.reasoningTokens
    if (cost !== undefined && !cost.priced) unpriced += 1
  }
  return {
    inputTokens: input,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: input + cacheRead + cacheWrite + output,
    apiCalls: costed.length,
    unpricedCalls: unpriced,
    toolCalls,
    sessions,
  }
}

function groupTools(
  calls: readonly ToolCallRecord[],
  costed: readonly CostedRequest[],
  engine: PricingEngine,
): ToolSummary[] {
  const stepToCost = new Map<string, ComputedCost[]>()
  const stepToCalls = new Map<string, ToolCallRecord[]>()
  for (const { record, cost } of costed) {
    if (cost === undefined) continue
    const key = `${record.sessionId}/${record.turn}/${record.step}`
    const list = stepToCost.get(key)
    if (list === undefined) stepToCost.set(key, [cost])
    else list.push(cost)
  }
  for (const call of calls) {
    const key = `${call.sessionId}/${call.turn}/${call.step}`
    const list = stepToCalls.get(key)
    if (list === undefined) stepToCalls.set(key, [call])
    else list.push(call)
  }

  const byName = new Map<string, {
    calls: number
    errors: number
    apiCalls: number
    totalTokens: number
    cost: number
    currency?: string
  }>()
  for (const call of calls) {
    const entry = byName.get(call.name) ?? { calls: 0, errors: 0, apiCalls: 0, totalTokens: 0, cost: 0, currency: undefined }
    entry.calls += 1
    if (call.isError === true) entry.errors += 1
    byName.set(call.name, entry)
  }
  for (const [key, costs] of stepToCost) {
    const calls = stepToCalls.get(key)
    if (calls === undefined || calls.length === 0) continue
    const share = costs.reduce((sum, cost) => sum + cost.cost, 0) / calls.length
    const currency = costs.find(cost => cost.cost > 0)?.currency
    const costedBy = new Set(calls.map(call => call.name))
    for (const name of costedBy) {
      const entry = byName.get(name)
      if (entry === undefined) continue
      entry.apiCalls += 1
      entry.totalTokens += 1
      entry.cost += share
      entry.currency ??= currency
    }
  }
  return [...byName.entries()].map(([name, entry]) => ({
    name,
    calls: entry.calls,
    errors: entry.errors,
    successRate: entry.calls === 0 ? 1 : (entry.calls - entry.errors) / entry.calls,
    apiCalls: entry.apiCalls,
    totalTokens: entry.totalTokens,
    cost: entry.currency === undefined ? [] : [{ currency: entry.currency, amount: entry.cost }],
  })).sort((a, b) => {
    const costDiff = (b.cost[0]?.amount ?? 0) - (a.cost[0]?.amount ?? 0)
    return costDiff !== 0 ? costDiff : b.calls - a.calls
  })
}

function requestViews(costed: readonly CostedRequest[]): RequestView[] {
  return costed.map(({ record, cost }) => ({
    turn: record.turn,
    step: record.step,
    seq: record.seq,
    provider: record.provider,
    model: record.model,
    ...(record.reasoningEffort === undefined ? {} : { reasoningEffort: record.reasoningEffort }),
    time: record.time,
    inputTokens: record.inputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens,
    ...(cost === undefined || cost.cost === 0 ? {} : { cost: { currency: cost.currency, amount: cost.cost } }),
  }))
}

/** Concrete analytics service over one store and pricing engine. */
export class AnalyticsLocal extends AnalyticsService {
  /**
   * @param ctx - plugin context.
   * @param deps - store and pricing engine, plus optional budget/currency preferences.
   */
  constructor(
    ctx: Context,
    private readonly deps: {
      store: AnalyticsStore
      engine: PricingEngine
      budget?: { daily?: number; monthly?: number; currency?: string }
      currency?: string
    },
  ) {
    super(ctx)
  }

  async overview(request?: AnalyticsRange): Promise<AnalyticsOverview> {
    const range = this.resolveRange(request)
    const store = this.deps.store
    const requests = store.requests(range)
    const costed = costRequests(requests, this.deps.engine)
    const toolCalls = store.toolCalls(range).length
    const sessionCount = new Set(requests.map(record => record.sessionId)).size
    const totals = tokenTotals(costed, toolCalls, sessionCount)
    const cost = sumCosts(costed.map(costedRequest => costedRequest.cost))
    const cache = cacheSummary(requests, this.deps.engine)
    const reasoningTokens = totals.reasoningTokens
    const sessionRows = new Map(store.sessions().map(row => [row.sessionId, row]))

    const byModel = new Map<string, ModelSummary>()
    for (const { record, cost: requestCost } of costed) {
      const key = `${record.provider}\u0000${record.model}`
      const entry = byModel.get(key) ?? {
        provider: record.provider,
        model: record.model,
        apiCalls: 0,
        unpricedCalls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cost: [] as CostSummary[],
      }
      entry.apiCalls += 1
      if (requestCost !== undefined && !requestCost.priced) entry.unpricedCalls += 1
      entry.inputTokens += record.inputTokens
      entry.cacheReadTokens += record.cacheReadTokens
      entry.cacheWriteTokens += record.cacheWriteTokens
      entry.outputTokens += record.outputTokens
      entry.reasoningTokens += record.reasoningTokens
      if (requestCost !== undefined && requestCost.cost > 0) {
        const existing = entry.cost.find(summary => summary.currency === requestCost.currency)
        if (existing === undefined) entry.cost.push({ currency: requestCost.currency, amount: requestCost.cost })
        else existing.amount += requestCost.cost
      }
      byModel.set(key, entry)
    }

    const bySession = new Map<string, SessionSummary>()
    for (const { record, cost: requestCost } of costed) {
      const row = sessionRows.get(record.sessionId)
      const entry = bySession.get(record.sessionId) ?? {
        sessionId: record.sessionId,
        ...(row?.cwd === undefined ? {} : { cwd: row.cwd }),
        ...(row?.title === undefined ? {} : { title: row.title }),
        ...(row?.parentSession === undefined ? {} : { parentSession: row.parentSession }),
        createdAt: row?.createdAt ?? 0,
        apiCalls: 0,
        unpricedCalls: 0,
        totalTokens: 0,
        cost: [] as CostSummary[],
      }
      entry.apiCalls += 1
      if (requestCost !== undefined && !requestCost.priced) entry.unpricedCalls += 1
      entry.totalTokens += record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens
      if (requestCost !== undefined && requestCost.cost > 0) {
        const existing = entry.cost.find(summary => summary.currency === requestCost.currency)
        if (existing === undefined) entry.cost.push({ currency: requestCost.currency, amount: requestCost.cost })
        else existing.amount += requestCost.cost
      }
      bySession.set(record.sessionId, entry)
    }

    return {
      range,
      totals,
      cost: this.preferCurrency(cost),
      cache,
      reasoning: {
        tokens: reasoningTokens,
        shareOfOutput: totals.outputTokens === 0 ? 0 : reasoningTokens / totals.outputTokens,
        shareOfTotal: totals.totalTokens === 0 ? 0 : reasoningTokens / totals.totalTokens,
      },
      trend: this.buildTrend(costed, range),
      byModel: [...byModel.values()].sort((a, b) => this.costAmount(b.cost) - this.costAmount(a.cost)),
      bySession: [...bySession.values()].sort((a, b) => b.createdAt - a.createdAt),
      ...(this.deps.budget === undefined ? {} : { budget: await this.budget() }),
    }
  }

  async session(sessionId: string): Promise<SessionAnalytics> {
    const store = this.deps.store
    const requests = store.requestsForSession(sessionId)
    const costed = costRequests(requests, this.deps.engine)
    const calls = store.toolCallsForSession(sessionId)
    const row = store.sessions().find(candidate => candidate.sessionId === sessionId)
    const totals = tokenTotals(costed, calls.length, requests.length === 0 ? 0 : 1)
    const turns = new Map<number, TurnSummary>()
    for (const { record, cost } of costed) {
      const entry = turns.get(record.turn) ?? {
        turn: record.turn,
        apiCalls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cost: [] as CostSummary[],
      }
      entry.apiCalls += 1
      entry.inputTokens += record.inputTokens
      entry.cacheReadTokens += record.cacheReadTokens
      entry.cacheWriteTokens += record.cacheWriteTokens
      entry.outputTokens += record.outputTokens
      entry.reasoningTokens += record.reasoningTokens
      entry.totalTokens += record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens
      if (cost !== undefined && cost.cost > 0) {
        const existing = entry.cost.find(summary => summary.currency === cost.currency)
        if (existing === undefined) entry.cost.push({ currency: cost.currency, amount: cost.cost })
        else existing.amount += cost.cost
      }
      turns.set(record.turn, entry)
    }
    const tools = groupTools(calls, costed, this.deps.engine)
    return {
      sessionId,
      ...(row?.cwd === undefined ? {} : { cwd: row.cwd }),
      ...(row?.title === undefined ? {} : { title: row.title }),
      ...(row?.parentSession === undefined ? {} : { parentSession: row.parentSession }),
      createdAt: row?.createdAt ?? 0,
      apiCalls: totals.apiCalls,
      unpricedCalls: totals.unpricedCalls,
      totalTokens: totals.totalTokens,
      cost: this.preferCurrency(sumCosts(costed.map(costedRequest => costedRequest.cost))),
      requests: requestViews(costed),
      turns: [...turns.values()].sort((a, b) => a.turn - b.turn),
      tools,
      cache: cacheSummary(requests, this.deps.engine),
    }
  }

  async sessions(request?: AnalyticsRange): Promise<SessionSummary[]> {
    const overview = await this.overview(request)
    return overview.bySession
  }

  async models(request?: AnalyticsRange): Promise<ModelSummary[]> {
    const overview = await this.overview(request)
    return overview.byModel
  }

  async tools(request?: AnalyticsRange): Promise<ToolSummary[]> {
    const range = this.resolveRange(request)
    const store = this.deps.store
    const calls = store.toolCalls(range)
    const costed = costRequests(store.requests(range), this.deps.engine)
    return groupTools(calls, costed, this.deps.engine)
  }

  async pricing(): Promise<PricingRow[]> {
    return this.deps.store.loadPricing()
  }

  async budget(request?: { now?: number }): Promise<BudgetSummary> {
    const budget = this.deps.budget
    if (budget === undefined) return {}
    const now = request?.now ?? Date.now()
    const result: BudgetSummary = {}
    const engine = this.deps.engine
    const store = this.deps.store
    const currency = budget.currency ?? this.deps.currency ?? 'USD'
    if (budget.daily !== undefined) {
      const start = startOfUtcDay(now)
      const spent = this.spendIn(store, engine, { start, end: now }, currency)
      result.daily = { limit: budget.daily, spent, currency, ratio: spent / budget.daily }
    }
    if (budget.monthly !== undefined) {
      const date = new Date(now)
      const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
      const spent = this.spendIn(store, engine, { start, end: now }, currency)
      const daysElapsed = Math.max(1, Math.floor((now - start) / DAY_MS) + 1)
      const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
      result.monthly = {
        limit: budget.monthly,
        spent,
        currency,
        ratio: spent / budget.monthly,
        projected: spent / daysElapsed * daysInMonth,
      }
    }
    return result
  }

  private resolveRange(request?: AnalyticsRange): { start: number; end: number } {
    return {
      start: request?.start ?? 0,
      end: request?.end ?? Date.now(),
    }
  }

  private preferCurrency(costs: CostSummary[]): CostSummary[] {
    if (this.deps.currency === undefined) return costs
    return [...costs].sort((a, b) => {
      const aPreferred = a.currency === this.deps.currency ? 0 : 1
      const bPreferred = b.currency === this.deps.currency ? 0 : 1
      return aPreferred - bPreferred || b.amount - a.amount
    })
  }

  private costAmount(costs: CostSummary[]): number {
    return costs[0]?.amount ?? 0
  }

  private spendIn(
    store: AnalyticsStore,
    engine: PricingEngine,
    range: { start: number; end: number },
    currency: string,
  ): number {
    let spent = 0
    for (const record of store.requests(range)) {
      const cost = engine.costFor(record)
      if (cost !== undefined && cost.currency === currency) spent += cost.cost
    }
    return spent
  }

  private buildTrend(
    costed: readonly CostedRequest[],
    range: { start: number; end: number },
  ): TrendPoint[] {
    const bucketMs = range.end - range.start <= 2 * DAY_MS ? HOUR_MS : DAY_MS
    const first = Math.floor(range.start / bucketMs) * bucketMs
    const buckets = new Map<number, TrendPoint>()
    for (let start = first; start < range.end; start += bucketMs) {
      buckets.set(start, {
        bucketStart: start,
        apiCalls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        cost: [],
      })
    }
    for (const { record, cost } of costed) {
      const start = Math.floor(record.time / bucketMs) * bucketMs
      const bucket = buckets.get(start)
      if (bucket === undefined) continue
      bucket.apiCalls += 1
      bucket.inputTokens += record.inputTokens
      bucket.cacheReadTokens += record.cacheReadTokens
      bucket.cacheWriteTokens += record.cacheWriteTokens
      bucket.outputTokens += record.outputTokens
      if (cost !== undefined && cost.cost > 0) {
        const existing = bucket.cost.find(summary => summary.currency === cost.currency)
        if (existing === undefined) bucket.cost.push({ currency: cost.currency, amount: cost.cost })
        else existing.amount += cost.cost
      }
    }
    return [...buckets.values()].map(bucket => ({
      ...bucket,
      cost: this.preferCurrency(bucket.cost.sort((a, b) => b.amount - a.amount)),
    }))
  }
}

export type { SessionRow }
