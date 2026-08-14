/**
 * Visual QA harness: drives headless Edge over the preview server and
 * measures overlapping elements, text overflow, SVG chart-label collisions,
 * font-size distribution, and viewport overflow.
 *
 * Run `pnpm preview` in one terminal, then:
 *   node scripts/visual-qa.mjs
 *
 * @module dsh-analytics/scripts/visual-qa
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/analytics'
const DEBUG_PORT = 9223

const PAGES = [
  { name: 'overview', hash: '#/overview', marker: 'Total Cost' },
  { name: 'sessions', hash: '#/sessions', marker: 'Created' },
  { name: 'session-detail', hash: '#/session/session-1', marker: 'Turn Waterfall' },
  { name: 'pricing', hash: '#/pricing', marker: 'Pricing Table' },
]

const MEASURE = `(() => {
  const clipRect = (el) => {
    let r = el.getBoundingClientRect()
    let node = el.parentElement
    while (node !== null && node !== document.documentElement) {
      const s = getComputedStyle(node)
      if (/(auto|scroll|hidden)/.test(s.overflowY) || /(auto|scroll|hidden)/.test(s.overflowX)) {
        const pr = node.getBoundingClientRect()
        r = {
          left: Math.max(r.left, pr.left),
          right: Math.min(r.right, pr.right),
          top: Math.max(r.top, pr.top),
          bottom: Math.min(r.bottom, pr.bottom),
        }
        if (r.right <= r.left || r.bottom <= r.top) return null
      }
      node = node.parentElement
    }
    return r
  }
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) !== 0
      && el.getAttribute('aria-hidden') !== 'true'
      && rect.bottom > 0 && rect.top < innerHeight
      && rect.right > 0 && rect.left < innerWidth
  }
  const html = [...document.querySelectorAll('body *')].filter(el => !el.closest('svg') && visible(el))
  const report = { overlaps: [], svgLabelOverlaps: [], overflows: [], fonts: {}, viewport: { w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight } }
  const label = (el) => {
    const text = (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 30)
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '') + (text ? ':' + text : '')
  }
  for (let i = 0; i < html.length; i++) {
    for (let j = i + 1; j < html.length; j++) {
      const a = html[i], b = html[j]
      if (a.contains(b) || b.contains(a)) continue
      const ra = clipRect(a), rb = clipRect(b)
      if (ra === null || rb === null) continue
      const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (x > 4 && y > 4 && x * y > 100) {
        report.overlaps.push({ a: label(a), b: label(b), area: Math.round(x * y) })
      }
    }
  }
  const texts = [...document.querySelectorAll('svg text')].filter(visible)
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const ra = clipRect(texts[i]), rb = clipRect(texts[j])
      if (ra === null || rb === null) continue
      const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (x > 1 && y > 1) {
        report.svgLabelOverlaps.push({ a: texts[i].textContent, b: texts[j].textContent, area: Math.round(x * y) })
      }
    }
  }
  for (const el of html) {
    const style = getComputedStyle(el)
    if (el.scrollWidth > el.clientWidth + 2 && style.whiteSpace !== 'normal' && style.textOverflow === 'clip') {
      report.overflows.push({ el: label(el), sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 60) })
    }
    const fs = style.fontSize
    report.fonts[fs] = (report.fonts[fs] ?? 0) + 1
  }
  report.overlaps.sort((a, b) => b.area - a.area)
  report.svgLabelOverlaps.sort((a, b) => b.area - a.area)
  return report
})()`

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-visual-qa-'))
  const edge = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1500,950',
    `${BASE}${PAGES[0].hash}`,
  ], { stdio: 'ignore' })

  try {
    let targets
    for (let i = 0; i < 40; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        targets = await response.json()
        if (targets.some(t => t.type === 'page')) break
      } catch (_) { /* Edge still starting */ }
      await sleep(250)
    }
    const page = targets?.find(t => t.type === 'page')
    if (page === undefined) throw new Error('no CDP page target')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    let nextId = 1
    const pending = new Map()
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    }
    const send = (method, params = {}) => new Promise(resolve => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (expression) => {
      const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (message.result?.exceptionDetails !== undefined) {
        throw new Error(message.result.exceptionDetails.text ?? 'evaluation failed')
      }
      return message.result?.result?.value
    }
    await send('Runtime.enable')
    await send('Page.enable')

    const all = {}
    for (const pageSpec of PAGES) {
      await send('Page.navigate', { url: `${BASE}?qa=1${pageSpec.hash}` })
      let ready = false
      for (let i = 0; i < 60; i++) {
        await sleep(250)
        const body = await evaluate('document.body ? document.body.innerText : ""')
        if (body.includes(pageSpec.marker)) { ready = true; break }
      }
      if (!ready) {
        const body = await evaluate('document.body ? document.body.innerText.slice(0, 400) : ""')
        all[pageSpec.name] = { error: `marker not found: ${pageSpec.marker}`, body }
        continue
      }
      await sleep(500)
      all[pageSpec.name] = await evaluate(MEASURE)
    }
    console.log(JSON.stringify(all, null, 2))
  } finally {
    edge.kill()
  }
}

main().catch(error => {
  console.error(String(error))
  process.exitCode = 1
})
