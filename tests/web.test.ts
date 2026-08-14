import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { AnalyticsLocal } from '../src/analytics.ts'
import { DEFAULT_PRICING } from '../src/default-pricing.ts'
import { PricingEngine } from '../src/pricing.ts'
import { AnalyticsStore } from '../src/store.ts'
import type { AnalyticsService } from '../src/service.ts'
import { registerAnalyticsRoutes, resolveWebAsset } from '../src/web.ts'

const T0 = Date.parse('2026-08-01T10:00:00Z')

test('resolveWebAsset maps only whitelisted dashboard files', () => {
  assert.equal(resolveWebAsset('/analytics')?.file, 'index.html')
  assert.equal(resolveWebAsset('/analytics/')?.file, 'index.html')
  assert.equal(resolveWebAsset('/analytics/index.html')?.file, 'index.html')
  assert.equal(resolveWebAsset('/analytics/app.js')?.file, 'app.js')
  assert.equal(resolveWebAsset('/analytics/style.css')?.type, 'text/css; charset=utf-8')
  assert.equal(resolveWebAsset('/analytics/../secret'), undefined)
  assert.equal(resolveWebAsset('/analytics/server.js'), undefined)
  assert.equal(resolveWebAsset('/api/analytics/overview'), undefined)
})

class FakeRes {
  status = 0
  headers: Record<string, string> = {}
  body = ''

  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status
    this.headers = headers
    return this
  }

  end(body?: unknown): void {
    this.body = body === undefined ? '' : String(body)
  }
}

interface FakeRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: { method: string; url: string }, res: FakeRes) => void | Promise<void>
}

class FakeWebServer {
  readonly routes = new Map<string, FakeRoute>()

  register(route: FakeRoute): () => void {
    this.routes.set(route.path, route)
    return () => { this.routes.delete(route.path) }
  }
}

async function request(route: FakeRoute, method: string, url: string): Promise<FakeRes> {
  const res = new FakeRes()
  await route.handler({ method, url }, res)
  return res
}

async function mountRoutes(): Promise<{ server: FakeWebServer; store: AnalyticsStore }> {
  const store = new AnalyticsStore(':memory:')
  store.upsertSession({ sessionId: 'session-1', createdAt: T0 })
  store.upsertRequest({
    sessionId: 'session-1', turn: 1, step: 1, seq: 1,
    provider: 'deepseek', model: 'deepseek-v4-pro', time: T0,
    inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0,
    outputTokens: 500, reasoningTokens: 100,
  })
  const ctx = new Context()
  await ctx.plugin(AnalyticsLocal, { store, engine: new PricingEngine(DEFAULT_PRICING) })
  const server = new FakeWebServer()
  registerAnalyticsRoutes({ webServer: server } as unknown, ctx.analytics as unknown as AnalyticsService)
  return { server, store }
}

test('dashboard assets are served with content types and 404 on unknown paths', async () => {
  const { server } = await mountRoutes()
  const route = server.routes.get('/analytics')
  assert.ok(route !== undefined)

  const index = await request(route, 'GET', '/analytics')
  assert.equal(index.status, 200)
  assert.match(index.headers['content-type'], /text\/html/)
  assert.match(index.body, /Token Analytics/)

  const script = await request(route, 'GET', '/analytics/app.js')
  assert.equal(script.status, 200)
  assert.match(script.headers['content-type'], /text\/javascript/)
  assert.match(script.body, /renderOverview/)

  const missing = await request(route, 'GET', '/analytics/secret.db')
  assert.equal(missing.status, 404)

  const forbidden = await request(route, 'POST', '/analytics')
  assert.equal(forbidden.status, 405)
})

test('JSON API routes answer from the analytics service', async () => {
  const { server, store } = await mountRoutes()
  try {
    const overview = await request(server.routes.get('/api/analytics/overview')!, 'GET', '/api/analytics/overview')
    assert.equal(overview.status, 200)
    const body = JSON.parse(overview.body) as { totals: { apiCalls: number } }
    assert.equal(body.totals.apiCalls, 1)

    const detail = await request(server.routes.get('/api/analytics/session')!, 'GET', '/api/analytics/session/session-1')
    assert.equal(detail.status, 200)
    assert.equal((JSON.parse(detail.body) as { sessionId: string }).sessionId, 'session-1')

    const reasoning = await request(server.routes.get('/api/analytics/reasoning')!, 'GET', '/api/analytics/reasoning')
    assert.equal(reasoning.status, 200)
    assert.ok(Array.isArray(JSON.parse(reasoning.body)))

    const agents = await request(server.routes.get('/api/analytics/agents')!, 'GET', '/api/analytics/agents')
    assert.equal(agents.status, 200)
    assert.ok(Array.isArray(JSON.parse(agents.body)))
    const insights = await request(server.routes.get('/api/analytics/insights')!, 'GET', '/api/analytics/insights')
    assert.equal(insights.status, 200)
    assert.ok(Array.isArray(JSON.parse(insights.body)))

    const missingId = await request(server.routes.get('/api/analytics/session')!, 'GET', '/api/analytics/session/')
    assert.equal(missingId.status, 400)
  } finally {
    store.close()
  }
})

test('dashboard and JSON routes work over a real HTTP server', async () => {
  const { server: fakeServer, store } = await mountRoutes()
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const exact = [...fakeServer.routes.values()].find(route => route.kind === 'exact' && route.path === url.pathname)
    const prefixes = [...fakeServer.routes.values()]
      .filter(route => route.kind === 'prefix' && (url.pathname === route.path || url.pathname.startsWith(route.path + '/')))
      .sort((a, b) => b.path.length - a.path.length)
    const route = exact ?? prefixes[0]
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req as never, res as never)
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`

    const index = await (await fetch(`${base}/analytics`)).text()
    assert.match(index, /Token Analytics/)
    const app = await (await fetch(`${base}/analytics/app.js`)).text()
    assert.match(app, /renderOverview/)
    const overview = await (await fetch(`${base}/api/analytics/overview?hours=0`)).json() as { totals: { apiCalls: number } }
    assert.equal(overview.totals.apiCalls, 1)
    const missing = await fetch(`${base}/analytics/secret`)
    assert.equal(missing.status, 404)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.close()
  }
})
