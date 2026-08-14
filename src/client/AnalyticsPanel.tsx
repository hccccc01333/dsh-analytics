/**
 * Session analytics overlay: the per-session "task cost" panel.
 *
 * Fetches `/api/analytics/session/<id>` from the plugin's host routes and
 * renders KPI cards, the turn waterfall, and tool attribution. Read-only:
 * the panel never writes to the session store or the analytics database.
 */
import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { fmtCost, fmtPct, fmtTime, fmtTokens } from './format.ts'
import css from './Analytics.module.css'

/** Subset of the host session analytics payload the panel renders. */
export interface SessionAnalyticsPayload {
  sessionId: string
  apiCalls: number
  unpricedCalls: number
  totalTokens: number
  cost: { currency: string; amount: number }[]
  cache: {
    cacheReadTokens: number
    uncachedInputTokens: number
    hitRate: number
    savings: { currency: string; amount: number }[]
  }
  turns: {
    turn: number
    apiCalls: number
    totalTokens: number
    inputTokens: number
    cacheReadTokens: number
    outputTokens: number
    reasoningTokens: number
    cost: { currency: string; amount: number }[]
  }[]
  tools: {
    name: string
    calls: number
    errors: number
    successRate: number
    totalTokens: number
    cost: { currency: string; amount: number }[]
  }[]
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: SessionAnalyticsPayload }

/** Overlay props: the target session and the plugin's dictionary. */
export interface AnalyticsPanelProps {
  sessionId: string
  t: TranslateNS<typeof NS>
  onClose: () => void
}

/**
 * Render the analytics overlay for one session.
 * @param props - session id, dictionary, and close callback.
 * @returns the overlay element tree.
 */
export function AnalyticsPanel({ sessionId, t, onClose }: AnalyticsPanelProps) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    fetch(`/api/analytics/session/${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }
        return response.json() as Promise<SessionAnalyticsPayload>
      })
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <div className={css.overlay}>
      <div className={css.backdrop} onClick={onClose} aria-hidden="true" />
      <div className={css.panel} role="dialog" aria-label={t('panel.title')}>
        <div className={css.header}>
          <span className={css.title}>{t('panel.title')}</span>
          <a className={css.dashboardLink} href="/analytics" target="_blank" rel="noreferrer">
            {t('panel.dashboard')}
          </a>
          <button className={css.close} type="button" onClick={onClose} aria-label={t('panel.close')}>
            ×
          </button>
        </div>
        <div className={css.body}>
          {state.kind === 'loading' && <div className={css.state}>{t('state.loading')}</div>}
          {state.kind === 'error' && <div className={`${css.state} ${css.error}`}>{t('state.error')}: {state.message}</div>}
          {state.kind === 'ready' && <ReadyContent data={state.data} t={t} />}
        </div>
      </div>
    </div>
  )
}

function ReadyContent({ data, t }: { data: SessionAnalyticsPayload; t: TranslateNS<typeof NS> }) {
  if (data.turns.length === 0 && data.apiCalls === 0) {
    return <div className={css.state}>{t('state.empty')}</div>
  }
  return (
    <>
      <div className={css.cards}>
        <Kpi label={t('kpi.cost')} value={fmtCost(data.cost)} />
        <Kpi label={t('kpi.tokens')} value={fmtTokens(data.totalTokens)} />
        <Kpi
          label={t('kpi.cache')}
          value={fmtPct(data.cache.hitRate)}
          hint={data.cache.savings.length > 0 ? `${t('cache.saved')} ${fmtCost(data.cache.savings)}` : undefined}
        />
        <Kpi
          label={t('kpi.calls')}
          value={String(data.apiCalls)}
          hint={data.unpricedCalls > 0 ? `${data.unpricedCalls} ${t('kpi.unpriced')}` : undefined}
        />
      </div>
      <h3 className={css.section}>{t('waterfall.title')}</h3>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('waterfall.turn')}</th>
            <th className={css.right}>{t('waterfall.calls')}</th>
            <th className={css.right}>{t('waterfall.input')}</th>
            <th className={css.right}>{t('waterfall.cache')}</th>
            <th className={css.right}>{t('waterfall.output')}</th>
            <th className={css.right}>{t('waterfall.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {data.turns.map(turn => (
            <tr key={turn.turn}>
              <td>#{String(turn.turn).padStart(2, '0')}</td>
              <td className={css.right}>{turn.apiCalls}</td>
              <td className={css.right}>{fmtTokens(turn.inputTokens)}</td>
              <td className={css.right}>{fmtTokens(turn.cacheReadTokens)}</td>
              <td className={css.right}>{fmtTokens(turn.outputTokens)}</td>
              <td className={css.right}>{fmtCost(turn.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.tools.length > 0 && (
        <>
          <h3 className={css.section}>{t('tools.title')}</h3>
          <table className={css.table}>
            <thead>
              <tr>
                <th>{t('tools.name')}</th>
                <th className={css.right}>{t('tools.calls')}</th>
                <th className={css.right}>{t('tools.errors')}</th>
                <th className={css.right}>{t('tools.success')}</th>
                <th className={css.right}>{t('tools.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {data.tools.map(tool => (
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

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={css.kpi}>
      <div className={css.kpiLabel}>{label}</div>
      <div className={css.kpiValue}>{value}</div>
      {hint !== undefined && <div className={css.kpiHint}>{hint}</div>}
    </div>
  )
}
