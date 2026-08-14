/* global fetch, document, location, localStorage */
/**
 * Token Analytics dashboard — vanilla JS, no build step.
 * Consumes the plugin's read-only /api/analytics/* JSON routes.
 */
(function () {
  'use strict'

  const HOUR = 3600000

  const api = {
    overview(hours) { return get('/api/analytics/overview' + qs({ hours })) },
    sessions(hours) { return get('/api/analytics/sessions' + qs({ hours })) },
    session(id) { return get('/api/analytics/session/' + encodeURIComponent(id)) },
    models(hours) { return get('/api/analytics/models' + qs({ hours })) },
    tools(hours) { return get('/api/analytics/tools' + qs({ hours })) },
    pricing() { return get('/api/analytics/pricing') },
    budget() { return get('/api/analytics/budget') },
  }

  async function get(path) {
    const response = await fetch(path, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      let message = response.status + ' ' + response.statusText
      try {
        const body = await response.json()
        if (body && body.error) message += ': ' + body.error
      } catch (_) { /* non-JSON error body */ }
      throw new Error(message)
    }
    return response.json()
  }

  function qs(params) {
    const parts = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
    return parts.length === 0 ? '' : '?' + parts.map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&')
  }

  const fmt = {
    tokens(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K'
      return String(Math.round(n))
    },
    money(amount, currency) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: amount < 1 ? 4 : 2 }).format(amount)
      } catch (_) {
        return (currency || '') + ' ' + amount.toFixed(4)
      }
    },
    cost(list) {
      if (list === undefined || list.length === 0) return '—'
      return list.map(entry => this.money(entry.amount, entry.currency)).join(' / ')
    },
    pct(ratio) { return (ratio * 100).toFixed(1) + '%' },
    time(ms) {
      const d = new Date(ms)
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    },
    timeShort(ms) {
      return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    },
    date(ms) {
      return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    },
    duration(ms) {
      const seconds = Math.round(ms / 1000)
      if (seconds < 60) return seconds + 's'
      const minutes = Math.floor(seconds / 60)
      return minutes + 'm' + (seconds % 60) + 's'
    },
    number(n) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n) },
  }

  // ---------- DOM helpers (textContent-only, no innerHTML with data) ----------
  function el(tag, props, children) {
    const node = document.createElement(tag)
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue
        if (key === 'class') node.className = value
        else if (key === 'dataset') Object.assign(node.dataset, value)
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
        else node.setAttribute(key, String(value))
      }
    }
    const append = (list) => {
      for (const child of list) {
        if (child === undefined || child === null || child === false) continue
        if (Array.isArray(child)) { append(child); continue }
        node.appendChild(typeof child === 'string' || typeof child === 'number'
          ? document.createTextNode(String(child))
          : child)
      }
    }
    append(children === undefined ? [] : Array.isArray(children) ? children : [children])
    return node
  }

  function card(label, value, hint) {
    return el('div', { class: 'card' }, [
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value),
      ...(hint ? [el('div', { class: 'hint' }, hint)] : []),
    ])
  }

  function panel(title, body) {
    return el('div', { class: 'panel' }, [el('h2', {}, title), ...(Array.isArray(body) ? body : [body])])
  }

  function table(headers, rows, opts) {
    const head = el('thead', {}, el('tr', {}, headers.map(h => el('th', { class: h.align === 'right' ? 'right' : undefined }, h.label))))
    const body = el('tbody', {}, rows.map(row => {
      const tr = el('tr', {
        class: opts && opts.onRowClick ? 'row-link' : undefined,
        ...(opts && opts.onRowClick ? { onclick: () => opts.onRowClick(row) } : {}),
      }, row.cells.map(cell => el('td', { class: typeof cell === 'object' && cell.align === 'right' ? 'right' : undefined },
        typeof cell === 'object' ? cell.value : cell)))
      return tr
    }))
    return el('table', {}, [head, body])
  }

  function rightCell(value, cls) {
    return { value, align: 'right', ...(cls ? { cls } : {}) }
  }

  // ---------- SVG charts ----------
  function chart(svgMarkup, small) {
    const holder = el('div', { class: 'flow-chart' + (small ? ' small' : '') })
    holder.innerHTML = svgMarkup // numeric-only payload, safe by construction
    return holder
  }

  function lineChart(series, opts) {
    const width = 880
    const height = opts.height || 240
    const pad = { top: 12, right: 12, bottom: 24, left: 54 }
    const innerW = width - pad.left - pad.right
    const innerH = height - pad.top - pad.bottom
    let max = 1
    for (const s of series) for (const v of s.points) if (v > max) max = v
    max = niceMax(max)
    const xs = series[0] ? series[0].points.map((_, i) => i) : []
    const x = i => pad.left + (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * innerW)
    const y = v => pad.top + innerH - (v / max) * innerH
    const path = s => s.points.map((v, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')
    const area = s => path(s) + ' L' + x(s.points.length - 1).toFixed(1) + ' ' + (pad.top + innerH) + ' L' + x(0).toFixed(1) + ' ' + (pad.top + innerH) + ' Z'
    const grid = []
    const steps = 4
    for (let i = 0; i <= steps; i++) {
      const v = (max / steps) * i
      grid.push('<line x1="' + pad.left + '" y1="' + y(v).toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + y(v).toFixed(1) + '" stroke="#232b36" stroke-width="1"/>')
      grid.push('<text x="' + (pad.left - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#5d6b7d">' + fmt.tokens(v) + '</text>')
    }
    const labels = series[0] && series[0].labels
      ? series[0].labels.map((label, i) => '<text x="' + x(i).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle" font-size="11" fill="#5d6b7d">' + label + '</text>')
      : ''
    const paths = series.map((s, i) =>
      '<path d="' + area(s) + '" fill="' + s.color + '" opacity="0.12"/>'
      + '<path d="' + path(s) + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round"/>')
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" role="img">'
      + grid.join('') + labels + paths.join('') + '</svg>'
  }

  function niceMax(value) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
    const norm = value / magnitude
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
    return nice * magnitude
  }

  function legend(items) {
    return el('div', { class: 'chart-legend' }, items.map(item =>
      el('span', {}, [
        el('span', { class: 'legend-dot', style: 'background:' + item.color }),
        item.label,
      ])))
  }

  function trendSeries(trend, pickers) {
    const labels = trend.map(point => {
      const bucket = point.bucketStart
      return trend.length > 48 ? fmt.date(bucket) : fmt.timeShort(bucket)
    })
    return pickers.map(([label, color, pick]) => ({
      label, color,
      labels,
      points: trend.map(pick),
    }))
  }

  // ---------- state ----------
  const state = {
    hours: Number(localStorage.getItem('dsh-analytics-range') || 24),
    route: '#/overview',
  }

  const TABS = [
    ['overview', 'Overview'],
    ['sessions', 'Sessions'],
    ['flow', 'Token Flow'],
    ['models', 'Models'],
    ['cost', 'Cost'],
    ['pricing', 'Pricing'],
  ]

  // ---------- pages ----------
  async function renderOverview() {
    const [overview, budget] = await Promise.all([api.overview(state.hours), api.budget()])
    const t = overview.totals
    const c = overview.cache
    const r = overview.reasoning
    const main = []

    main.push(el('div', { class: 'cards' }, [
      card('Total Cost', fmt.cost(overview.cost), overview.cost.length === 0 ? 'unpriced' : undefined),
      card('Total Tokens', fmt.tokens(t.totalTokens), t.apiCalls + ' API calls'),
      card('Cache Hit Rate', fmt.pct(c.hitRate), 'saved ' + fmt.cost(c.savings)),
      card('Reasoning Share', fmt.pct(r.shareOfTotal), fmt.tokens(r.tokens) + ' reasoning tokens'),
      card('API Calls', fmt.number(t.apiCalls), t.unpricedCalls + ' unpriced'),
      card('Tool Calls', fmt.number(t.toolCalls), t.sessions + ' sessions'),
    ]))

    if (overview.budget && (overview.budget.daily || overview.budget.monthly)) {
      main.push(budgetPanel(overview.budget))
    }

    if (overview.trend.length > 0) {
      const series = trendSeries(overview.trend, [
        ['Input', '#4c9aff', p => p.inputTokens],
        ['Cache read', '#3ec7d6', p => p.cacheReadTokens],
        ['Output', '#9d8cff', p => p.outputTokens],
      ])
      main.push(panel('Token Trend', [
        chart(lineChart(series, {})),
        legend(series.map(s => ({ label: s.label, color: s.color }))),
      ]))

      const costSeries = trendSeries(overview.trend, [
        ['Cost', '#e8b64c', p => {
          const entry = p.cost && p.cost[0]
          return entry ? entry.amount * 1e6 : 0 // tokens-scale for a readable axis
        }],
      ])
      main.push(panel('Cost Trend (per bucket, primary currency)', [
        chart(lineChart(costSeries, { height: 180 }), true),
      ]))
    }

    main.push(el('div', { class: 'grid-2' }, [
      panel('Token Composition', [compositionBar(overview.totals)]),
      panel('Cost by Model', [modelList(overview.byModel)]),
    ]))

    main.push(panel('Sessions', [sessionTable(overview.bySession)]))
    return main
  }

  function budgetPanel(budget) {
    const rows = []
    if (budget.daily) {
      rows.push(metricBar('Daily', budget.daily.spent / budget.daily.limit, budget.daily, fmt.money(budget.daily.spent, budget.daily.currency) + ' / ' + fmt.money(budget.daily.limit, budget.daily.currency)))
    }
    if (budget.monthly) {
      rows.push(metricBar('Monthly', budget.monthly.spent / budget.monthly.limit, budget.monthly,
        fmt.money(budget.monthly.spent, budget.monthly.currency) + ' / ' + fmt.money(budget.monthly.limit, budget.monthly.currency)
        + ' · projected ' + fmt.money(budget.monthly.projected, budget.monthly.currency)))
    }
    return panel('Budget', rows)
  }

  function metricBar(label, ratio, data, valueText) {
    const color = ratio >= 1 ? 'var(--red)' : ratio >= 0.8 ? 'var(--amber)' : 'var(--accent)'
    return el('div', { class: 'metric-bar' }, [
      el('div', { class: 'm-label' }, label),
      el('div', { class: 'm-track' }, el('div', { class: 'm-fill', style: 'width:' + Math.min(100, ratio * 100).toFixed(1) + '%;background:' + color })),
      el('div', { class: 'm-value' }, valueText),
    ])
  }

  function compositionBar(totals) {
    const parts = [
      ['Uncached input', totals.inputTokens, 'var(--accent)'],
      ['Cache read', totals.cacheReadTokens, 'var(--cyan)'],
      ['Cache write', totals.cacheWriteTokens, 'var(--violet)'],
      ['Output', totals.outputTokens, 'var(--green)'],
    ]
    const sum = Math.max(1, totals.totalTokens)
    const track = el('div', { class: 'm-track', style: 'height:16px;width:100%' })
    for (const [, tokens, color] of parts) {
      if (tokens <= 0) continue
      track.appendChild(el('div', { style: 'display:inline-block;height:100%;width:' + (tokens / sum * 100).toFixed(2) + '%;background:' + color }))
    }
    const rows = parts.filter(([, tokens]) => tokens > 0).map(([label, tokens, color]) =>
      el('div', { class: 'metric-bar' }, [
        el('span', { class: 'legend-dot', style: 'background:' + color }),
        el('span', { class: 'm-label', style: 'text-align:left;flex:1' }, label),
        el('span', { class: 'm-value' }, fmt.pct(tokens / sum) + ' · ' + fmt.tokens(tokens)),
      ]))
    return [track, el('div', { style: 'margin-top:10px' }, rows)]
  }

  function modelList(models) {
    if (models.length === 0) return el('div', { class: 'dim' }, 'No priced requests in range.')
    const top = models.slice(0, 8)
    const maxCost = Math.max(1, ...top.map(m => (m.cost[0] && m.cost[0].amount) || 0))
    return top.map(model => {
      const cost = model.cost[0]
      const ratio = cost ? cost.amount / maxCost : 0
      return el('div', { class: 'metric-bar' }, [
        el('div', { class: 'm-label', style: 'text-align:left;flex:1;overflow:hidden;text-overflow:ellipsis' },
          model.model + (model.provider ? ' · ' + model.provider : '')),
        el('div', { class: 'm-track' }, el('div', { class: 'm-fill', style: 'width:' + (ratio * 100).toFixed(1) + '%' })),
        el('div', { class: 'm-value' }, cost ? fmt.money(cost.amount, cost.currency) : '—'),
      ])
    })
  }

  async function renderSessions() {
    const sessions = await api.sessions(state.hours)
    if (sessions.length === 0) {
      return [el('div', { class: 'panel' }, el('div', { class: 'dim' }, 'No sessions with usage in range.'))]
    }
    const rows = sessions.map(session => ({
      session,
      cells: [
        session.sessionId,
        session.title || session.cwd || '—',
        fmt.time(session.createdAt),
        rightCell(fmt.number(session.apiCalls)),
        rightCell(fmt.tokens(session.totalTokens)),
        rightCell(fmt.cost(session.cost)),
      ],
    }))
    return [panel('Sessions', table(
      [{ label: 'Session' }, { label: 'Title / cwd' }, { label: 'Created' }, { label: 'Calls', align: 'right' }, { label: 'Tokens', align: 'right' }, { label: 'Cost', align: 'right' }],
      rows.map(row => row),
      { onRowClick: row => navigate('#/session/' + encodeURIComponent(row.session.sessionId)) },
    ))]
  }

  async function renderSession(sessionId) {
    const detail = await api.session(sessionId)
    const main = [
      el('button', { class: 'back', onclick: () => navigate('#/sessions') }, '← Sessions'),
      el('div', { class: 'cards' }, [
        card('Session', detail.sessionId, detail.title || detail.cwd || ''),
        card('API Calls', fmt.number(detail.apiCalls), detail.unpricedCalls + ' unpriced'),
        card('Total Tokens', fmt.tokens(detail.totalTokens)),
        card('Total Cost', fmt.cost(detail.cost)),
        card('Cache Hit Rate', fmt.pct(detail.cache.hitRate), 'saved ' + fmt.cost(detail.cache.savings)),
      ]),
    ]

    const turnRows = detail.turns.map(turn => ({
      cells: [
        '#' + String(turn.turn).padStart(2, '0'),
        rightCell(fmt.number(turn.apiCalls)),
        rightCell(fmt.tokens(turn.inputTokens)),
        rightCell(fmt.tokens(turn.cacheReadTokens)),
        rightCell(fmt.tokens(turn.outputTokens)),
        rightCell(fmt.tokens(turn.reasoningTokens)),
        rightCell(fmt.cost(turn.cost)),
      ],
    }))
    main.push(panel('Turn Waterfall', table(
      [{ label: 'Turn' }, { label: 'Calls', align: 'right' }, { label: 'Input', align: 'right' }, { label: 'Cache', align: 'right' }, { label: 'Output', align: 'right' }, { label: 'Reasoning', align: 'right' }, { label: 'Cost', align: 'right' }],
      turnRows,
    )))

    const cumulative = []
    let running = 0
    for (const request of detail.requests) {
      running += request.inputTokens + request.cacheReadTokens + request.cacheWriteTokens
      cumulative.push({ time: request.time, tokens: running })
    }
    if (cumulative.length > 1) {
      const series = [{
        label: 'Cumulative context',
        color: '#4c9aff',
        labels: cumulative.map(point => fmt.timeShort(point.time)),
        points: cumulative.map(point => point.tokens),
      }]
      main.push(panel('Cumulative Context (per request)', [
        chart(lineChart(series, { height: 180 }), true),
      ]))
    }

    if (detail.tools.length > 0) {
      const toolRows = detail.tools.map(tool => ({
        cells: [
          tool.name,
          rightCell(fmt.number(tool.calls)),
          rightCell(fmt.number(tool.errors)),
          rightCell(fmt.pct(tool.successRate)),
          rightCell(fmt.tokens(tool.totalTokens)),
          rightCell(fmt.cost(tool.cost)),
        ],
      }))
      main.push(panel('Tools', table(
        [{ label: 'Tool' }, { label: 'Calls', align: 'right' }, { label: 'Errors', align: 'right' }, { label: 'Success', align: 'right' }, { label: 'Step tokens', align: 'right' }, { label: 'Step cost', align: 'right' }],
        toolRows,
      )))
    }
    return main
  }

  async function renderFlow() {
    const overview = await api.overview(state.hours)
    if (overview.trend.length === 0) {
      return [el('div', { class: 'panel' }, el('div', { class: 'dim' }, 'No requests in range.'))]
    }
    const series = trendSeries(overview.trend, [
      ['Input', '#4c9aff', p => p.inputTokens],
      ['Cache read', '#3ec7d6', p => p.cacheReadTokens],
      ['Cache write', '#9d8cff', p => p.cacheWriteTokens],
      ['Output', '#34c98a', p => p.outputTokens],
    ])
    return [
      panel('Token Flow', [
        chart(lineChart(series, { height: 300 })),
        legend(series.map(s => ({ label: s.label, color: s.color }))),
      ]),
      panel('Per-bucket totals', [compositionBar(overview.totals)]),
    ]
  }

  async function renderModels() {
    const models = await api.models(state.hours)
    if (models.length === 0) {
      return [el('div', { class: 'panel' }, el('div', { class: 'dim' }, 'No priced requests in range.'))]
    }
    const rows = models.map(model => ({
      cells: [
        model.model,
        model.provider,
        rightCell(fmt.number(model.apiCalls)),
        rightCell(fmt.tokens(model.inputTokens)),
        rightCell(fmt.tokens(model.cacheReadTokens)),
        rightCell(fmt.tokens(model.outputTokens)),
        rightCell(fmt.tokens(model.reasoningTokens)),
        rightCell(fmt.cost(model.cost)),
      ],
    }))
    return [panel('Cost by Model', table(
      [{ label: 'Model' }, { label: 'Provider' }, { label: 'Calls', align: 'right' }, { label: 'Input', align: 'right' }, { label: 'Cache', align: 'right' }, { label: 'Output', align: 'right' }, { label: 'Reasoning', align: 'right' }, { label: 'Cost', align: 'right' }],
      rows,
    ))]
  }

  async function renderCost() {
    const [overview, tools, budget] = await Promise.all([api.overview(state.hours), api.tools(state.hours), api.budget()])
    const main = []
    if (overview.budget && (overview.budget.daily || overview.budget.monthly)) {
      main.push(budgetPanel(overview.budget))
    }
    const series = trendSeries(overview.trend, [
      ['Cost', '#e8b64c', p => {
        const entry = p.cost && p.cost[0]
        return entry ? entry.amount * 1e6 : 0
      }],
    ])
    if (overview.trend.length > 0) {
      main.push(panel('Cost Trend', [chart(lineChart(series, { height: 200 }), true)]))
    }
    main.push(el('div', { class: 'grid-2' }, [
      panel('Cost by Model', [modelList(overview.byModel)]),
      panel('Cost by Session', [sessionCostList(overview.bySession)]),
    ]))
    if (tools.length > 0) {
      const rows = tools.map(tool => ({
        cells: [
          tool.name,
          rightCell(fmt.number(tool.calls)),
          rightCell(fmt.number(tool.errors)),
          rightCell(fmt.pct(tool.successRate)),
          rightCell(fmt.tokens(tool.totalTokens)),
          rightCell(fmt.cost(tool.cost)),
        ],
      }))
      main.push(panel('Cost by Tool (step attribution)', table(
        [{ label: 'Tool' }, { label: 'Calls', align: 'right' }, { label: 'Errors', align: 'right' }, { label: 'Success', align: 'right' }, { label: 'Step tokens', align: 'right' }, { label: 'Step cost', align: 'right' }],
        rows,
      )))
    }
    return main
  }

  function sessionCostList(sessions) {
    if (sessions.length === 0) return el('div', { class: 'dim' }, 'No sessions in range.')
    const maxCost = Math.max(1, ...sessions.map(s => (s.cost[0] && s.cost[0].amount) || 0))
    return sessions.slice(0, 10).map(session => {
      const cost = session.cost[0]
      const ratio = cost ? cost.amount / maxCost : 0
      return el('div', { class: 'metric-bar' }, [
        el('div', { class: 'm-label', style: 'text-align:left;flex:1;overflow:hidden;text-overflow:ellipsis;cursor:pointer', onclick: () => navigate('#/session/' + encodeURIComponent(session.sessionId)) },
          session.sessionId),
        el('div', { class: 'm-track' }, el('div', { class: 'm-fill', style: 'width:' + (ratio * 100).toFixed(1) + '%' })),
        el('div', { class: 'm-value' }, cost ? fmt.money(cost.amount, cost.currency) : '—'),
      ])
    })
  }

  async function renderPricing() {
    const rows = await api.pricing()
    if (rows.length === 0) {
      return [el('div', { class: 'panel' }, el('div', { class: 'dim' }, 'Pricing table is empty.'))]
    }
    const formatted = rows.map(row => ({
      cells: [
        row.model,
        row.provider,
        el('span', { class: 'badge ' + row.priceType }, row.priceType),
        row.inputType,
        rightCell('$' + row.pricePerMillion.toFixed(4) + (row.currency !== 'USD' ? ' ' + row.currency : '')),
        fmt.time(Date.parse(row.effectiveFrom)),
        row.effectiveTo ? fmt.time(Date.parse(row.effectiveTo)) : 'now',
      ],
    }))
    return [panel('Pricing Table (' + rows.length + ' rows)', table(
      [{ label: 'Model' }, { label: 'Provider' }, { label: 'Window' }, { label: 'Bucket' }, { label: '$/1M tokens', align: 'right' }, { label: 'Effective from' }, { label: 'Effective to' }],
      formatted,
    ))]
  }

  function sessionTable(sessions) {
    if (sessions.length === 0) return el('div', { class: 'dim' }, 'No sessions in range.')
    const rows = sessions.map(session => ({
      session,
      cells: [
        session.sessionId,
        session.title || session.cwd || '—',
        fmt.time(session.createdAt),
        rightCell(fmt.number(session.apiCalls)),
        rightCell(fmt.tokens(session.totalTokens)),
        rightCell(fmt.cost(session.cost)),
      ],
    }))
    return table(
      [{ label: 'Session' }, { label: 'Title / cwd' }, { label: 'Created' }, { label: 'Calls', align: 'right' }, { label: 'Tokens', align: 'right' }, { label: 'Cost', align: 'right' }],
      rows,
      { onRowClick: row => navigate('#/session/' + encodeURIComponent(row.session.sessionId)) },
    )
  }

  // ---------- router ----------
  function navigate(route) {
    location.hash = route
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#/, '') || '/overview'
    const [path, param] = raw.split('/').filter(Boolean)
    return { path: path || 'overview', param }
  }

  async function boot() {
    renderTabs()
    const range = document.getElementById('range')
    range.value = String(state.hours)
    range.addEventListener('change', () => {
      state.hours = Number(range.value)
      localStorage.setItem('dsh-analytics-range', String(state.hours))
      void refresh()
    })
    document.getElementById('refresh').addEventListener('click', () => void refresh())
    window.addEventListener('hashchange', () => void refresh())
    await refresh()
  }

  function renderTabs() {
    const tabs = document.getElementById('tabs')
    for (const [id, label] of TABS) {
      tabs.appendChild(el('button', { class: 'tab', dataset: { page: id }, onclick: () => navigate('#/' + id) }, label))
    }
  }

  async function refresh() {
    const route = parseRoute()
    const tabs = document.querySelectorAll('.tab')
    for (const tab of tabs) {
      tab.classList.toggle('active', tab.dataset.page === route.path)
    }
    const main = document.getElementById('main')
    const refreshButton = document.getElementById('refresh')
    main.replaceChildren(el('div', { class: 'loading' }, 'Loading…'))
    refreshButton.disabled = true
    try {
      const nodes = await dispatch(route)
      main.replaceChildren(...nodes)
    } catch (error) {
      main.replaceChildren(el('div', { class: 'error' }, 'Failed to load analytics: ' + (error instanceof Error ? error.message : String(error))))
    } finally {
      refreshButton.disabled = false
    }
  }

  async function dispatch(route) {
    switch (route.path) {
      case 'overview': return renderOverview()
      case 'sessions': return renderSessions()
      case 'session': return renderSession(decodeURIComponent(route.param || ''))
      case 'flow': return renderFlow()
      case 'models': return renderModels()
      case 'cost': return renderCost()
      case 'pricing': return renderPricing()
      default: return [el('div', { class: 'panel' }, el('div', { class: 'dim' }, 'Unknown page: ' + route.path))]
    }
  }

  boot()
})()
