/**
 * Pure number/currency formatting for the browser half.
 *
 * Kept dependency-free and side-effect-free so the same helpers serve the
 * header action panel and the full `/analytics` dashboard.
 *
 * @module dsh-analytics/client/format
 */

/** Compact token count: 1.23M, 45.6K, 812. */
export function fmtTokens(tokens: number): string {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(tokens >= 1e7 ? 1 : 2)}M`
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(tokens >= 1e5 ? 0 : 1)}K`
  return String(Math.round(tokens))
}

/** Currency-formatted amount with small-amount precision. */
export function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount < 1 ? 4 : 2,
    }).format(amount)
  } catch (_) {
    return `${currency} ${amount.toFixed(4)}`
  }
}

/** Format a per-currency cost list; empty lists render as an em dash. */
export function fmtCost(costs: readonly { currency: string; amount: number }[] | undefined): string {
  if (costs === undefined || costs.length === 0) return '—'
  return costs.map(entry => fmtMoney(entry.amount, entry.currency)).join(' / ')
}

/** Format a 0..1 ratio as a percentage. */
export function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/** Compact local timestamp for waterfall rows. */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** Compact duration: `47s`, `3m42s`. */
export function fmtDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${seconds % 60}s`
}
