/**
 * Sidebar-foot action opening the full-screen Analytics panel.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { NS } from './locales.ts'
import { AnalyticsApp } from './AnalyticsApp.tsx'
import css from './Analytics.module.css'

/** Full props of the sidebar-foot analytics action. */
export type AnalyticsFooterActionProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS>

/**
 * Render the foot action (wide row or rail glyph) and, while open, the
 * full-screen analytics panel.
 * @param props - owner `wide` flag + dictionary.
 * @returns the action button plus the panel when open.
 */
export function AnalyticsFooterAction(props: AnalyticsFooterActionProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={`${css.footerAction} ${props.wide ? '' : css.footerActionRail}`}
        onClick={() => setOpen(true)}
        title={props.t('app.title')}
      >
        <svg className={css.footerGlyph} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 13h12M3 13V7h2.5v6M7.5 13V3H10v10M12 13V9h1.5v4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
        {props.wide && <span className={css.footerLabel}>{props.t('action.footer')}</span>}
      </button>
      {open && <AnalyticsApp t={props.t} onClose={() => setOpen(false)} />}
    </>
  )
}
