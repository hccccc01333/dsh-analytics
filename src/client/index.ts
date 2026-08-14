/**
 * dsh-analytics browser half: one session-header action opening the
 * per-session Token Analytics overlay.
 *
 * @module dsh-analytics/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (header actions) and the
// locale service merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-sidebar SlotMap merge (sidebar footer actions).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AnalyticsHeaderAction } from './AnalyticsHeaderAction.tsx'
import { AnalyticsFooterAction } from './AnalyticsFooterAction.tsx'
import { TurnCostTail, selectTurnCost } from './TurnCostTail.tsx'
import { en, zh, type AnalyticsKey } from './locales.ts'

export { AnalyticsHeaderAction } from './AnalyticsHeaderAction.tsx'
export { AnalyticsFooterAction } from './AnalyticsFooterAction.tsx'
export { TurnCostTail, selectTurnCost } from './TurnCostTail.tsx'
export { AnalyticsPanel } from './AnalyticsPanel.tsx'
export { AnalyticsApp } from './AnalyticsApp.tsx'
export { NS, en, zh } from './locales.ts'
export type { AnalyticsKey } from './locales.ts'
export { fmtCost, fmtDuration, fmtMoney, fmtPct, fmtTime, fmtTokens } from './format.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The analytics action and overlay copy. */
    analytics: AnalyticsKey
  }
}

/** Services required by the browser half. */
export const inject = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-sidebar',
]

/**
 * Register the dictionaries and the session-header analytics action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('analytics', { zh, en }), 'dsh-analytics: dictionaries')

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'analytics',
      // After job list and other per-session controls; negative orders are
      // reserved for static session context.
      order: 40,
      locale: 'analytics',
    }, AnalyticsHeaderAction),
  )

  ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'analytics',
      order: 10,
      locale: 'analytics',
    }, AnalyticsFooterAction),
  )

  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      locale: 'analytics',
      priority: 10,
      select: selectTurnCost,
    }, TurnCostTail),
  )
}
