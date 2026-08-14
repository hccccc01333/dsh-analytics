/**
 * Optional JSON API routes behind the harness web server.
 *
 * The routes are read-only projections of the analytics store, intended as
 * the data source for a future analytics dashboard page. They register only
 * when the deployment mounts `ctx.webServer`.
 *
 * @module dsh-analytics/web
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AnalyticsService } from './service.ts'

/** The subset of the web server contract this plugin needs (duck-typed). */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** One servable dashboard asset: package-relative file and content type. */
export interface WebAsset {
  /** Path of the asset file relative to the package `web/` directory. */
  file: string
  /** HTTP content type header value. */
  type: string
}

/** Whitelisted dashboard assets; unknown paths answer 404, never filesystem access. */
const DASHBOARD_ASSETS: ReadonlyMap<string, WebAsset> = new Map([
  ['', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
])

/**
 * Map a `/analytics` request pathname to a whitelisted dashboard asset.
 * Path traversal is impossible by construction: the map is the only source
 * of file names.
 * @param pathname - the request pathname (e.g. `/analytics/app.js`).
 * @returns the asset descriptor, or undefined for unknown paths.
 */
export function resolveWebAsset(pathname: string): WebAsset | undefined {
  const name = pathname.replace(/^\/analytics\/?/, '')
  return DASHBOARD_ASSETS.get(name)
}

/** Register the `/api/analytics/*` routes; no-op without a web server. */
export function registerAnalyticsRoutes(ctx: unknown, analytics: AnalyticsService): void {
  const webServer = (ctx as { webServer?: WebServerLike }).webServer
  if (webServer === undefined) return

  const exact = (path: string, handler: (search: URLSearchParams) => Promise<unknown>) => {
    webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        return serveJson(req, res, async () => ({
          body: await handler(new URL(req.url ?? '/', 'http://localhost').searchParams),
        }))
      },
    })
  }

  exact('/api/analytics/overview', async (search) => {
    const hours = parseHours(search.get('hours'))
    return analytics.overview(hours)
  })
  exact('/api/analytics/sessions', async (search) => analytics.sessions(parseHours(search.get('hours'))))
  exact('/api/analytics/models', async (search) => analytics.models(parseHours(search.get('hours'))))
  exact('/api/analytics/tools', async (search) => analytics.tools(parseHours(search.get('hours'))))
  exact('/api/analytics/reasoning', async (search) => analytics.reasoning(parseHours(search.get('hours'))))
  exact('/api/analytics/agents', async (search) => analytics.agents(parseHours(search.get('hours'))))
  exact('/api/analytics/insights', async (search) => analytics.insights(parseHours(search.get('hours'))))
  exact('/api/analytics/inflation', async (search) => analytics.contextInflation(parseHours(search.get('hours'))))
  exact('/api/analytics/pricing', async () => analytics.pricing())
  exact('/api/analytics/budget', async () => analytics.budget())

  webServer.register({
    kind: 'prefix',
    path: '/api/analytics/session',
    handler: (req, res) => {
      return serveJson(req, res, async () => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = url.pathname.replace(/^\/api\/analytics\/session\/?/, '')
        if (sessionId === '') {
          return { status: 400, body: { error: 'session id is required' } }
        }
        return { body: await analytics.session(decodeURIComponent(sessionId)) }
      })
    },
  })

  webServer.register({
    kind: 'prefix',
    path: '/analytics',
    handler: (req, res) => {
      return serveDashboardAsset(req, res)
    },
  })
}

async function serveDashboardAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const asset = resolveWebAsset(url.pathname)
  if (asset === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  try {
    const body = await readFile(new URL(`../web/${asset.file}`, import.meta.url))
    res.writeHead(200, {
      'content-type': asset.type,
      'cache-control': 'no-cache',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: message }))
  }
}

function parseHours(raw: string | null): { start?: number } | undefined {
  if (raw === null) return undefined
  const hours = Number(raw)
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`invalid hours ${JSON.stringify(raw)}`)
  }
  if (hours === 0) return undefined
  return { start: Date.now() - hours * 3_600_000 }
}

async function serveJson(
  req: IncomingMessage,
  res: ServerResponse,
  run: () => Promise<{ status?: number; body: unknown }>,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }
  try {
    const { status = 200, body } = await run()
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: message }))
  }
}
