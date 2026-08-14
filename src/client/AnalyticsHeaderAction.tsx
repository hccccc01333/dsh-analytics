/**
 * Session-header action that opens the per-session analytics overlay.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS } from './locales.ts'
import { AnalyticsPanel } from './AnalyticsPanel.tsx'
import css from './Analytics.module.css'

/** Full props of the session-header analytics action. */
export type AnalyticsHeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>

/**
 * Render the header action button and, while open, the analytics overlay.
 * @param props - framework session kit + dictionary.
 * @returns the action button (plus overlay when open).
 */
export function AnalyticsHeaderAction(props: AnalyticsHeaderActionProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={css.action}
        onClick={() => setOpen(true)}
        title={props.t('panel.title')}
      >
        {props.t('action.label')}
      </button>
      {open && (
        <AnalyticsPanel
          sessionId={props.sessionId}
          t={props.t}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
