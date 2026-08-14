/**
 * Local preview server: seeds a demo analytics database and serves the
 * dashboard + JSON API on 127.0.0.1:4173 so you can see the effect without a
 * real harness run.
 *
 * Run: pnpm preview
 */

import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { AnalyticsLocal } from '../src/analytics.ts'
import { DEFAULT_PRICING } from '../src/default-pricing.ts'
import { PricingEngine } from '../src/pricing.ts'
import { AnalyticsStore } from '../src/store.ts'
import { registerAnalyticsRoutes } from '../src/web.ts'

const PORT = Number(process.env.PORT ?? 4173)
const NOW = Date.now()

const store = new AnalyticsStore(':memory:')
store.seedPricing(DEFAULT_PRICING, false)

function seedRequest(partial) {
  store.upsertRequest({
    turn: partial.turn,
    step: 1,
    seq: partial.seq,
    provider: 'deepseek',
    model: partial.model,
    ...(partial.reasoningEffort === undefined ? {} : { reasoningEffort: partial.reasoningEffort }),
    time: partial.time,
    inputTokens: partial.input ?? 0,
    cacheReadTokens: partial.cacheRead ?? 0,
    cacheWriteTokens: partial.cacheWrite ?? 0,
    outputTokens: partial.output ?? 0,
    reasoningTokens: partial.reasoning ?? 0,
    sessionId: partial.sessionId,
  })
}

function seedTool(sessionId, seq, turn, step, name, callId, isError = false, resultTokens = 0) {
  store.upsertToolCall({ sessionId, turn, step, seq, callId, name, time: NOW - 3600000 * (10 - seq) })
  store.pairToolResult({ sessionId, callId, resultSeq: seq + 1, isError, resultTokens })
}

const sessions = [
  { id: 'session-1', title: 'pokemon-agent · BCRL 分析', cwd: 'D:/work/pokemon-bcrl', createdAt: NOW - 5 * 3600000 },
  { id: 'session-2', title: 'sql-agent · 报表生成', cwd: 'D:/work/sql-agent', createdAt: NOW - 26 * 3600000 },
  { id: 'session-3', title: 'coding-agent · 重构 dsh-analytics', cwd: 'D:/work/coding-agent', createdAt: NOW - 50 * 3600000 },
  { id: 'session-4', title: 'research-agent · V4 定价调研', cwd: 'D:/work/research-agent', createdAt: NOW - 76 * 3600000 },
]
for (const session of sessions) store.upsertSession({ sessionId: session.id, createdAt: session.createdAt, cwd: session.cwd, title: session.title })

// session-1: heavy cache reuse, pro + max reasoning (今日高频).
// Interleaved seqs so each tool result is carried by the later requests.
seedRequest({ sessionId: 'session-1', seq: 1, turn: 1, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 4.9 * 3600000, input: 12400, cacheRead: 8100, output: 820, reasoning: 3200 })
seedTool('session-1', 2, 1, 1, 'web_search', 'c1', false, 12000)
seedRequest({ sessionId: 'session-1', seq: 4, turn: 2, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 4.2 * 3600000, input: 21800, cacheRead: 17700, output: 1300, reasoning: 4900 })
seedTool('session-1', 5, 2, 1, 'github_review', 'c2', true, 30000)
seedRequest({ sessionId: 'session-1', seq: 7, turn: 3, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 3.4 * 3600000, input: 38200, cacheRead: 31400, output: 2400, reasoning: 7800 })
seedTool('session-1', 8, 3, 1, 'excel_analysis', 'c3', false, 45000)
seedRequest({ sessionId: 'session-1', seq: 10, turn: 4, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 2.6 * 3600000, input: 67100, cacheRead: 59500, output: 3100, reasoning: 11200 })
seedTool('session-1', 11, 4, 1, 'web_search', 'c4', false, 14000)
seedRequest({ sessionId: 'session-1', seq: 13, turn: 5, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 1.8 * 3600000, input: 96400, cacheRead: 87300, output: 4200, reasoning: 15100 })
seedRequest({ sessionId: 'session-1', seq: 14, turn: 6, model: 'deepseek-v4-pro', reasoningEffort: 'high', time: NOW - 0.9 * 3600000, input: 128000, cacheRead: 119000, output: 3600, reasoning: 8400 })

// session-2: flash + high（昨天，低缓存命中）
seedRequest({ sessionId: 'session-2', seq: 1, turn: 1, model: 'deepseek-v4-flash', reasoningEffort: 'high', time: NOW - 25 * 3600000, input: 4200, cacheRead: 800, output: 640, reasoning: 1200 })
seedRequest({ sessionId: 'session-2', seq: 2, turn: 2, model: 'deepseek-v4-flash', reasoningEffort: 'high', time: NOW - 24 * 3600000, input: 8900, cacheRead: 2100, output: 980, reasoning: 1900 })

// session-3: pro + high，混合 cache
seedRequest({ sessionId: 'session-3', seq: 1, turn: 1, model: 'deepseek-v4-pro', reasoningEffort: 'high', time: NOW - 49 * 3600000, input: 15600, cacheRead: 5200, output: 2100, reasoning: 5600 })
seedRequest({ sessionId: 'session-3', seq: 2, turn: 2, model: 'deepseek-v4-pro', reasoningEffort: 'high', time: NOW - 47 * 3600000, input: 29800, cacheRead: 15100, output: 3800, reasoning: 9800 })
seedRequest({ sessionId: 'session-3', seq: 3, turn: 3, model: 'deepseek-v4-flash', reasoningEffort: 'low', time: NOW - 45 * 3600000, input: 5200, cacheRead: 900, output: 420, reasoning: 300 })

// session-4: pro + max，缓存命中率低（前缀频繁变化）
seedRequest({ sessionId: 'session-4', seq: 1, turn: 1, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 75 * 3600000, input: 9800, cacheRead: 1400, output: 1500, reasoning: 4200 })
seedRequest({ sessionId: 'session-4', seq: 2, turn: 2, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 73 * 3600000, input: 21400, cacheRead: 3900, output: 2600, reasoning: 8100 })

// Subagent sessions under session-1 (today's task) for the agent tree demo.
store.upsertSession({ sessionId: 'session-1-search', createdAt: NOW - 3.2 * 3600000, parentSession: 'session-1', cwd: 'D:/work/pokemon-bcrl', title: 'search subagent' })
seedRequest({ sessionId: 'session-1-search', seq: 1, turn: 1, model: 'deepseek-v4-flash', reasoningEffort: 'high', time: NOW - 3.2 * 3600000, input: 5200, cacheRead: 800, output: 900, reasoning: 1500 })
seedTool('session-1-search', 11, 1, 1, 'web_search', 'c5')
store.upsertSession({ sessionId: 'session-1-review', createdAt: NOW - 2.1 * 3600000, parentSession: 'session-1', cwd: 'D:/work/pokemon-bcrl', title: 'review subagent' })
seedRequest({ sessionId: 'session-1-review', seq: 1, turn: 1, model: 'deepseek-v4-pro', reasoningEffort: 'max', time: NOW - 2.1 * 3600000, input: 8400, cacheRead: 1900, output: 1400, reasoning: 3600 })

// Turn records: duration + outcome feed the waterfall and reasoning page.
const turnSeeds = [
  ['session-1', 1, NOW - 4.95 * 3600000, 42, 'completed'],
  ['session-1', 2, NOW - 4.25 * 3600000, 67, 'completed'],
  ['session-1', 3, NOW - 3.45 * 3600000, 95, 'completed'],
  ['session-1', 4, NOW - 2.65 * 3600000, 148, 'completed'],
  ['session-1', 5, NOW - 1.85 * 3600000, 203, 'error'],
  ['session-1', 6, NOW - 0.95 * 3600000, 121, 'completed'],
  ['session-1-search', 1, NOW - 3.25 * 3600000, 51, 'completed'],
  ['session-1-review', 1, NOW - 2.15 * 3600000, 76, 'completed'],
]
for (const [sessionId, turn, startTime, seconds, reason] of turnSeeds) {
  store.upsertTurnStart({ sessionId, turn, startTime })
  store.upsertTurnEnd({ sessionId, turn, endTime: startTime + seconds * 1000, reason })
}

const ctx = new Context()
await ctx.plugin(AnalyticsLocal, { store, engine: new PricingEngine(DEFAULT_PRICING), budget: { daily: 10, monthly: 100, currency: 'USD' } })

const routes = []
registerAnalyticsRoutes({ webServer: { register: route => { routes.push(route); return () => {} } } }, ctx.analytics)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const exact = routes.find(route => route.kind === 'exact' && route.path === url.pathname)
  const prefixes = routes
    .filter(route => route.kind === 'prefix' && (url.pathname === route.path || url.pathname.startsWith(route.path + '/')))
    .sort((a, b) => b.path.length - a.path.length)
  const route = exact ?? prefixes[0]
  if (route === undefined) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  Promise.resolve(route.handler(req, res)).catch(() => {})
})

await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
console.log(`dsh-analytics preview: http://127.0.0.1:${PORT}/analytics`)
