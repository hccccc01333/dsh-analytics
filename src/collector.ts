/**
 * Session-event fold that turns durable session-log events into usage rows.
 *
 * The collector is a pure fold over `SessionEvent` values: it tracks the
 * latest `request/header` per session, records each `assistant/message`
 * usage sample, and pairs `tool/call` with `tool/result`. Every write is an
 * idempotent upsert keyed by the event's durable seq, so live observation
 * and replay backfill can interleave freely without double counting.
 *
 * @module dsh-analytics/collector
 */

import type { EpochHeader, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AnalyticsStore } from './store.ts'
import type { ToolCallRecord, UsageRecord } from './types.ts'

/** The minimum live header the collector needs to price a request. */
interface RequestIdentity {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * Fold events from one session into the store.
 */
export class UsageCollector {
  private readonly headers = new Map<string, EpochHeader>()

  /**
   * @param store - destination store; ownership stays with the caller.
   */
  constructor(private readonly store: AnalyticsStore) {}

  /**
   * Replay-fold the events of one session that the cursor has not consumed.
   * Caller decides the source (live session log or persisted snapshot).
   *
   * @param sessionId - logical session id.
   * @param createdAt - session creation time, Unix epoch milliseconds.
   * @param cwd - optional session working directory.
   * @param parentSession - optional parent session id.
   * @param events - contiguous session-log events in ascending seq order.
   */
  backfill(
    sessionId: string,
    createdAt: number,
    events: readonly SessionEvent[],
    meta?: { cwd?: string; parentSession?: string },
  ): void {
    this.store.upsertSession({ sessionId, createdAt, ...meta })
    const lastSeq = this.store.lastSeq(sessionId)
    for (const event of events) {
      if (event.seq <= lastSeq) continue
      this.foldEvent(sessionId, event)
      this.store.setLastSeq(sessionId, event.seq)
    }
  }

  /**
   * Record a live session's header so its events carry identity.
   * @param sessionId - the live session id.
   * @param header - the session's immutable header.
   */
  observeSession(sessionId: string, header: { createdAt: number; cwd?: string; parentSession?: string }): void {
    this.store.upsertSession({ sessionId, ...header })
  }

  /**
   * Fold one live `session/event` append. Events already consumed by the
   * cursor are skipped; a concurrent backfill may already have folded them.
   *
   * @param sessionId - the session that owns the event.
   * @param event - the appended event.
   */
  observeEvent(sessionId: string, event: SessionEvent): void {
    if (event.seq <= this.store.lastSeq(sessionId)) return
    this.foldEvent(sessionId, event)
    this.store.setLastSeq(sessionId, event.seq)
  }

  private foldEvent(sessionId: string, event: SessionEvent): void {
    switch (event.type) {
      case 'request/header':
        this.headers.set(sessionId, event.data.header)
        break
      case 'assistant/message':
        if (event.data.usage !== undefined) {
          const identity = this.requestIdentity(sessionId)
          const usage = event.data.usage
          const record: UsageRecord = {
            sessionId,
            turn: event.data.turn,
            step: event.data.step,
            seq: event.seq,
            provider: identity.provider,
            model: identity.model,
            ...(identity.reasoningEffort === undefined ? {} : { reasoningEffort: identity.reasoningEffort }),
            time: event.time,
            inputTokens: usage.inputTokens,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.cacheWriteTokens ?? 0,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens ?? 0,
          }
          this.store.upsertRequest(record)
        }
        break
      case 'tool/call': {
        const call: ToolCallRecord = {
          sessionId,
          turn: event.data.turn,
          step: event.data.step,
          seq: event.seq,
          callId: String(event.data.callId),
          name: event.data.name,
          time: event.time,
        }
        this.store.upsertToolCall(call)
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        if (block?.toolCallId !== undefined) {
          this.store.pairToolResult({
            sessionId,
            callId: String(block.toolCallId),
            resultSeq: event.seq,
            isError: block.isError === true || event.data.error !== undefined,
          })
        }
        break
      }
      default:
        break
    }
  }

  private requestIdentity(sessionId: string): RequestIdentity {
    const header = this.headers.get(sessionId)
    if (header === undefined) return { provider: '', model: '' }
    const effort = header.config.reasoningEffort
    return {
      provider: header.config.provider,
      model: header.config.model,
      ...(effort === undefined ? {} : { reasoningEffort: String(effort) }),
    }
  }
}
