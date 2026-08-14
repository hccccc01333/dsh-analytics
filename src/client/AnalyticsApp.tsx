/**
 * Full-screen in-app Analytics panel opened from the sidebar foot.
 *
 * Mirrors the standalone `/analytics` dashboard as a native overlay: the same
 * six pages (Overview / Sessions / Token Flow / Models / Cost / Pricing)
 * consume the same read-only JSON routes. Clicking a session row opens the
 * per-session task-cost overlay on top.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { AnalyticsPanel, type SessionAnalyticsPayload } from './AnalyticsPanel.tsx'
import { fmtCost, fmtPct, fmtTokens } from './format.ts'
import css from './Analytics.module.css'

/** Cost pair as served by the host. */
interface CostEntry {
  currency: string
  amount: number
}

/** Overview payload subset rendered by the panel. */
interface OverviewPayload {
  totals: {
    inputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    outputTokens: number
    reasoningTokens: number
    totalTokens: number
    apiCalls: number
    unpricedCalls: number
    toolCalls: number
    sessions: number
  }
  cost: CostEntry[]
  cache: { hitRate: number; savings: CostEntry[] }
  reasoning: { shareOfTotal: number }
  byModel: {
    provider: string
    model: string
    apiCalls: number
    inputTokens: number
    cacheReadTokens: number
    outputTokens: number
    reasoningTokens: number
    cost: CostEntry[]
  }[]
  bySession: SessionSummaryPayload[]
  budget?: {
    daily?: { limit: number; spent: number; currency: string; ratio: number }
    monthly?: { limit: number; spent: number; currency: string; ratio: number; projected: number }
  }
}

interface SessionSummaryPayload {
  sessionId: string
  title?: string
  cwd?: string
  createdAt: number
  apiCalls: number
  totalTokens: number
  cost: CostEntry[]
}

interface TrendPoint {
  bucketStart: number
  apiCalls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  cost: CostEntry[]
}

type ModelPayload = OverviewPayload['byModel'][number]
interface ToolPayload {
  name: string
  calls: number
  errors: number
  successRate: number
  totalTokens: number
  cost: CostEntry[]
}
interface PricingPayload {
  model: string
  provider: string
  priceType: 'peak' | 'off-peak' | 'flat'
  inputType: string
  pricePerMillion: number
  currency: string
  effectiveFrom: string
  effectiveTo?: string
}

type Tab = 'overview' | 'sessions' | 'flow' | 'models' | 'cost' | 'pricing'
type RangeHours = 6 | 24 | 168 | 720 | 0

interface Loaded<T> {
  loading: boolean
  error?: string
  data?: T
}

function useJson<T>(path: string, refreshKey: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ loading: true })
  useEffect(() => {
    let cancelled = false
    setState({ loading: true })
    fetch(path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json() as Promise<T>
      })
      .then((data) => { if (!cancelled) setState({ loading: false, data }) })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => { cancelled = true }
  }, [path, refreshKey])
  return state
}

/** Full-screen analytics panel props. */
export interface AnalyticsAppProps {
  t: TranslateNS<typeof NS>
  onClose: () => void
}

const TABS: { id: Tab; labelKey: 'nav.overview' | 'nav.sessions' | 'nav.flow' | 'nav.models' | 'nav.cost' | 'nav.pricing' }[] = [
  { id: 'overview', labelKey: 'nav.overview' },
  { id: 'sessions', labelKey: 'nav.sessions' },
  { id: 'flow', labelKey: 'nav.flow' },
  { id: 'models', labelKey: 'nav.models' },
  { id: 'cost', labelKey: 'nav.cost' },
  { id: 'pricing', labelKey: 'nav.pricing' },
]

const RANGES: { value: RangeHours; label: string }[] = [
  { value: 6, label: '6h' },
  { value: 24, label: '24h' },
  { value: 168, label: '7d' },
  { value: 720, label: '30d' },
  { value: 0, label: 'All' },
]

/**
 * Render the full-screen analytics app.
 * @param props - dictionary and close callback.
 * @returns the overlay element tree.
 */
export function AnalyticsApp({ t, onClose }: AnalyticsAppProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [hours, setHours] = useState<RangeHours>(24)
  const [session, setSession] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const close = useCallback(() => onClose(), [onClose])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const hoursQuery = hours === 0 ? '' : `?hours=${hours}`
  const body = (
    <>
      <div className={css.toolbar}>
        <nav className={css.tabs}>
          {TABS.map(entry => (
            <button
              key={entry.id}
              type="button"
              className={`${css.tab} ${tab === entry.id ? css.tabActive : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </nav>
        <div className={css.toolbarControls}>
          <select
            className={css.rangeSelect}
            value={String(hours)}
            onChange={(event) => setHours(Number(event.target.value) as RangeHours)}
            aria-label={t('range.label')}
          >
            {RANGES.map(range => (
              <option key={range.value} value={String(range.value)}>{range.label}</option>
            ))}
          </select>
          <button type="button" className={css.iconBtn} onClick={() => setRefreshKey(key => key + 1)} title={t('range.refresh')}>
            ⟳
          </button>
        </div>
      </div>
      <div className={css.appBody}>
        <TabContent tab={tab} hoursQuery={hoursQuery} refreshKey={refreshKey} t={t} onSession={setSession} />
      </div>
    </>
  )

  return (
    <div className={css.appOverlay}>
      <div className={css.backdrop} onClick={close} aria-hidden="true" />
      <div className={css.app} role="dialog" aria-label={t('app.title')}>
        <div className={css.header}>
          <span className={css.title}>{t('app.title')}</span>
          <button className={css.close} type="button" onClick={close} aria-label={t('panel.close')}>×</button>
        </div>
        <div className={css.appMain}>
          {body}
        </div>
      </div>
      {session !== null && (
        <AnalyticsPanel sessionId={session} t={t} onClose={() => setSession(null)} />
      )}
    </div>
  )
}

function TabContent(props: {
  tab: Tab
  hoursQuery: string
  refreshKey: number
  t: TranslateNS<typeof NS>
  onSession: (sessionId: string) => void
}) {
  switch (props.tab) {
    case 'overview':
      return <OverviewView {...props} />
    case 'sessions':
      return <SessionsView {...props} />
    case 'flow':
      return <FlowView {...props} />
    case 'models':
      return <ModelsView {...props} />
    case 'cost':
      return <CostView {...props} />
    case 'pricing':
      return <PricingView {...props} />
  }
}

function State({ t, loaded }: { t: TranslateNS<typeof NS>; loaded: Loaded<unknown> }) {
  if (loaded.loading) return <div className={css.state}>{t('state.loading')}</div>
  if (loaded.error !== undefined) return <div className={`${css.state} ${css.error}`}>{t('state.error')}: {loaded.error}</div>
  return null
}

function OverviewView(props: { hoursQuery: string; refreshKey: number; t: TranslateNS<typeof NS>; onSession: (sessionId: string) => void }) {
  const loaded = useJson<OverviewPayload>(`/api/analytics/overview${props.hoursQuery}`, `${props.refreshKey}-overview`)
  const data = loaded.data
  return (
    <>
      <State t={props.t} loaded={loaded} />
      {data !== undefined && (
        <>
          <div className={css.cards}>
            <Kpi label={props.t('kpi.cost')} value={fmtCost(data.cost)} />
            <Kpi label={props.t('kpi.tokens')} value={fmtTokens(data.totals.totalTokens)} />
            <Kpi label={props.t('kpi.cache')} value={fmtPct(data.cache.hitRate)} hint={fmtCost(data.cache.savings)} />
            <Kpi label={props.t('kpi.calls')} value={String(data.totals.apiCalls)} />
          </div>
          {data.budget !== undefined && <BudgetBars budget={data.budget} t={props.t} />}
          <h3 className={css.section}>{props.t('nav.models')}</h3>
          <ModelBars models={data.byModel} />
          <h3 className={css.section}>{props.t('nav.sessions')}</h3>
          <SessionTable sessions={data.bySession} t={props.t} onSession={props.onSession} />
        </>
      )}
    </>
  )
}

function BudgetBars({ budget, t }: { budget: NonNullable<OverviewPayload['budget']>; t: TranslateNS<typeof NS> }) {
  const rows: ReactNode[] = []
  if (budget.daily !== undefined) {
    rows.push(<BarRow key="daily" label={t('budget.daily')} ratio={budget.daily.ratio}
      value={`${fmtCost([{ currency: budget.daily.currency, amount: budget.daily.spent }])} / ${fmtCost([{ currency: budget.daily.currency, amount: budget.daily.limit }])}`} />)
  }
  if (budget.monthly !== undefined) {
    rows.push(<BarRow key="monthly" label={t('budget.monthly')} ratio={budget.monthly.ratio}
      value={`${fmtCost([{ currency: budget.monthly.currency, amount: budget.monthly.spent }])} / ${fmtCost([{ currency: budget.monthly.currency, amount: budget.monthly.limit }])}`} />)
  }
  return <div>{rows}</div>
}

function BarRow({ label, ratio, value }: { label: string; ratio: number; value: string }) {
  return (
    <div className={css.metricBar}>
      <span className={css.metricLabel}>{label}</span>
      <span className={css.metricTrack}><span className={css.metricFill} style={{ width: `${Math.min(100, ratio * 100).toFixed(1)}%` }} /></span>
      <span className={css.metricValue}>{value}</span>
    </div>
  )
}

function ModelBars({ models }: { models: OverviewPayload['byModel'] }) {
  const maxCost = Math.max(1, ...models.map(model => model.cost[0]?.amount ?? 0))
  return models.slice(0, 8).map(model => (
    <BarRow
      key={`${model.provider}/${model.model}`}
      label={`${model.model}${model.provider ? ` · ${model.provider}` : ''}`}
      ratio={(model.cost[0]?.amount ?? 0) / maxCost}
      value={fmtCost(model.cost)}
    />
  ))
}

function SessionTable({ sessions, t, onSession }: {
  sessions: SessionSummaryPayload[]
  t: TranslateNS<typeof NS>
  onSession: (sessionId: string) => void
}) {
  if (sessions.length === 0) return <div className={css.state}>{t('state.empty')}</div>
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th>{t('table.session')}</th>
          <th className={css.right}>{t('table.calls')}</th>
          <th className={css.right}>{t('table.tokens')}</th>
          <th className={css.right}>{t('table.cost')}</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(session => (
          <tr key={session.sessionId} className={css.rowLink} onClick={() => onSession(session.sessionId)}>
            <td>
              <span className={css.titleCell} title={session.title ?? session.cwd ?? session.sessionId}>
                {session.title ?? session.cwd ?? session.sessionId}
              </span>
            </td>
            <td className={css.right}>{session.apiCalls}</td>
            <td className={css.right}>{fmtTokens(session.totalTokens)}</td>
            <td className={css.right}>{fmtCost(session.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SessionsView(props: { hoursQuery: string; refreshKey: number; t: TranslateNS<typeof NS>; onSession: (sessionId: string) => void }) {
  const loaded = useJson<SessionSummaryPayload[]>(`/api/analytics/sessions${props.hoursQuery}`, `${props.refreshKey}-sessions`)
  return (
    <>
      <State t={props.t} loaded={loaded} />
      {loaded.data !== undefined && <SessionTable sessions={loaded.data} t={props.t} onSession={props.onSession} />}
    </>
  )
}

function FlowView(props: { hoursQuery: string; refreshKey: number; t: TranslateNS<typeof NS> }) {
  const loaded = useJson<{ trend: TrendPoint[] }>(`/api/analytics/overview${props.hoursQuery}`, `${props.refreshKey}-flow`)
  const trend = loaded.data?.trend ?? []
  return (
    <>
      <State t={props.t} loaded={loaded} />
      {loaded.data !== undefined && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{props.t('table.bucket')}</th>
              <th className={css.right}>{props.t('table.calls')}</th>
              <th className={css.right}>{props.t('table.input')}</th>
              <th className={css.right}>{props.t('table.cache')}</th>
              <th className={css.right}>{props.t('table.output')}</th>
            </tr>
          </thead>
          <tbody>
            {trend.slice().reverse().map(point => (
              <tr key={point.bucketStart}>
                <td>{new Date(point.bucketStart).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td className={css.right}>{point.apiCalls}</td>
                <td className={css.right}>{fmtTokens(point.inputTokens)}</td>
                <td className={css.right}>{fmtTokens(point.cacheReadTokens)}</td>
                <td className={css.right}>{fmtTokens(point.outputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function ModelsView(props: { hoursQuery: string; refreshKey: number; t: TranslateNS<typeof NS> }) {
  const loaded = useJson<ModelPayload[]>(`/api/analytics/models${props.hoursQuery}`, `${props.refreshKey}-models`)
  return (
    <>
      <State t={props.t} loaded={loaded} />
      {loaded.data !== undefined && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{props.t('table.model')}</th>
              <th className={css.right}>{props.t('table.calls')}</th>
              <th className={css.right}>{props.t('table.input')}</th>
              <th className={css.right}>{props.t('table.cache')}</th>
              <th className={css.right}>{props.t('table.output')}</th>
              <th className={css.right}>{props.t('table.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {loaded.data.map(model => (
              <tr key={`${model.provider}/${model.model}`}>
                <td>{model.model}</td>
                <td className={css.right}>{model.apiCalls}</td>
                <td className={css.right}>{fmtTokens(model.inputTokens)}</td>
                <td className={css.right}>{fmtTokens(model.cacheReadTokens)}</td>
                <td className={css.right}>{fmtTokens(model.outputTokens)}</td>
                <td className={css.right}>{fmtCost(model.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function CostView(props: { hoursQuery: string; refreshKey: number; t: TranslateNS<typeof NS> }) {
  const models = useJson<ModelPayload[]>(`/api/analytics/models${props.hoursQuery}`, `${props.refreshKey}-cost-models`)
  const tools = useJson<ToolPayload[]>(`/api/analytics/tools${props.hoursQuery}`, `${props.refreshKey}-cost-tools`)
  return (
    <>
      <State t={props.t} loaded={models} />
      <State t={props.t} loaded={tools} />
      {models.data !== undefined && (
        <>
          <h3 className={css.section}>{props.t('nav.models')}</h3>
          <ModelBars models={models.data} />
        </>
      )}
      {tools.data !== undefined && tools.data.length > 0 && (
        <>
          <h3 className={css.section}>{props.t('tools.title')}</h3>
          <table className={css.table}>
            <thead>
              <tr>
                <th>{props.t('tools.name')}</th>
                <th className={css.right}>{props.t('tools.calls')}</th>
                <th className={css.right}>{props.t('tools.errors')}</th>
                <th className={css.right}>{props.t('tools.success')}</th>
                <th className={css.right}>{props.t('tools.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {tools.data.map(tool => (
                <tr key={tool.name}>
                  <td>{tool.name}</td>
                  <td className={css.right}>{tool.calls}</td>
                  <td className={css.right}>{tool.errors}</td>
                  <td className={css.right}>{fmtPct(tool.successRate)}</td>
                  <td className={css.right}>{fmtCost(tool.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

function PricingView(props: { refreshKey: number; t: TranslateNS<typeof NS> }) {
  const loaded = useJson<PricingPayload[]>('/api/analytics/pricing', `${props.refreshKey}-pricing`)
  return (
    <>
      <State t={props.t} loaded={loaded} />
      {loaded.data !== undefined && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{props.t('table.model')}</th>
              <th>{props.t('table.window')}</th>
              <th>{props.t('table.bucket')}</th>
              <th className={css.right}>{props.t('table.price')}</th>
              <th>{props.t('table.effectiveFrom')}</th>
            </tr>
          </thead>
          <tbody>
            {loaded.data.map((row, index) => (
              <tr key={index}>
                <td>{row.model}</td>
                <td><span className={`${css.badge} ${row.priceType === 'peak' ? css.badgePeak : row.priceType === 'off-peak' ? css.badgeOff : css.badgeFlat}`}>{row.priceType}</span></td>
                <td>{row.inputType}</td>
                <td className={css.right}>{row.pricePerMillion.toFixed(4)} {row.currency}</td>
                <td>{new Date(row.effectiveFrom).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={css.kpi}>
      <div className={css.kpiLabel}>{label}</div>
      <div className={css.kpiValue}>{value}</div>
      {hint !== undefined && <div className={css.kpiHint}>{hint}</div>}
    </div>
  )
}

export type { OverviewPayload, SessionSummaryPayload, SessionAnalyticsPayload }
