/**
 * Per-turn cost line rendered under the closing message of each turn.
 *
 * Reads the plugin's session analytics route and renders a compact
 * "tokens · cost · duration" footer for that turn. Stays invisible while the
 * analytics host (or the turn's data) is unavailable.
 */
import { useEffect, useState } from 'react'
import type { ChainSelect, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS } from './locales.ts'
import type { SessionAnalyticsPayload } from './AnalyticsPanel.tsx'
import { fmtCost, fmtDuration, fmtTokens } from './format.ts'
import css from './Analytics.module.css'

/** Chain election payload; the component reads the turn from owner props. */
export interface TurnCostMatch {
  turn: number
}

/** Elect this entry only for closed turns (an open turn has no final cost). */
export const selectTurnCost: ChainSelect<TurnTailOwnerProps, TurnCostMatch> = owner =>
  owner.turn.status === 'closed' ? { turn: owner.turn.turn } : null

/** Full props of the turn-cost tail entry. */
export type TurnCostTailProps =
  PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<typeof NS>

/**
 * Render the turn's cost footer.
 * @param props - turn owner currency + session kit + dictionary.
 * @returns the cost line, or nothing while loading or without data.
 */
export function TurnCostTail(props: TurnCostTailProps) {
  const sessionId = props.sessionId
  const turnNumber = props.turn.turn
  const [summary, setSummary] = useState<SessionAnalyticsPayload['turns'][number] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setSummary(undefined)
    fetch(`/api/analytics/session/${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json() as Promise<SessionAnalyticsPayload>
      })
      .then((data) => {
        if (!cancelled) setSummary(data.turns.find(turn => turn.turn === turnNumber))
      })
      .catch(() => {
        // The tail stays invisible when the analytics host is unavailable.
      })
    return () => { cancelled = true }
  }, [sessionId, turnNumber])

  if (summary === undefined) return null
  const start = props.turn.start?.time
  const end = props.turn.end?.time
  const duration = start !== undefined && end !== undefined ? end - start : undefined
  const parts = [
    `${fmtTokens(summary.totalTokens)} ${props.t('tail.unit')}`,
    ...(summary.cost.length > 0 ? [fmtCost(summary.cost)] : []),
    ...(duration !== undefined ? [fmtDuration(duration)] : []),
  ]
  return <div className={css.turnCostTail}>{parts.join(' · ')}</div>
}
