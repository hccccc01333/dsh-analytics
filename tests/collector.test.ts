import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { UsageCollector } from '../src/collector.ts'
import { AnalyticsStore } from '../src/store.ts'

function headerEvent(seq: number, time: number, config: { provider: string; model: string; reasoningEffort?: string }): SessionEvent<'request/header'> {
  return {
    type: 'request/header',
    seq,
    time,
    data: {
      header: { config } as unknown as SessionEvent<'request/header'>['data']['header'],
      reason: 'initial',
    },
  } as unknown as SessionEvent<'request/header'>
}

function assistantEvent(seq: number, time: number, turn: number, step: number, usage: Record<string, number>): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      step,
      message: { id: 'msg', role: 'assistant', content: [], source: { kind: 'model', model: '' } },
      usage,
    },
  } as unknown as SessionEvent<'assistant/message'>
}

function toolCallEvent(seq: number, time: number, turn: number, step: number, callId: string, name: string): SessionEvent<'tool/call'> {
  return {
    type: 'tool/call',
    seq,
    time,
    data: { turn, step, callId, name, arguments: '{}' },
  } as unknown as SessionEvent<'tool/call'>
}

function toolResultEvent(seq: number, time: number, turn: number, step: number, callId: string, isError: boolean): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result',
    seq,
    time,
    data: {
      turn,
      step,
      message: {
        id: 'tool-msg',
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: callId, content: [], ...(isError ? { isError: true } : {}) }],
        source: { kind: 'tool', name: 'web_search' },
      },
    },
  } as unknown as SessionEvent<'tool/result'>
}

function turnStartEvent(seq: number, time: number, turn: number): SessionEvent<'turn/start'> {
  return {
    type: 'turn/start',
    seq,
    time,
    data: { turn },
  } as unknown as SessionEvent<'turn/start'>
}

function turnEndEvent(seq: number, time: number, turn: number, reason: string): SessionEvent<'turn/end'> {
  return {
    type: 'turn/end',
    seq,
    time,
    data: { turn, reason: { kind: reason } },
  } as unknown as SessionEvent<'turn/end'>
}

test('collector folds usage, identity, and tool results into the store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-analytics-'))
  const store = new AnalyticsStore(join(dir, 'test.sqlite'))
  try {
    const collector = new UsageCollector(store)
    const t0 = Date.parse('2026-08-01T10:00:00Z')
    const events: SessionEvent[] = [
      headerEvent(0, t0, { provider: 'deepseek', model: 'deepseek-v4-pro', reasoningEffort: 'high' }),
      turnStartEvent(1, t0, 1),
      assistantEvent(2, t0 + 1000, 1, 1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, reasoningTokens: 10 }),
      toolCallEvent(3, t0 + 2000, 1, 1, 'call-1', 'web_search'),
      toolResultEvent(4, t0 + 3000, 1, 1, 'call-1', true),
      headerEvent(5, t0 + 4000, { provider: 'deepseek', model: 'deepseek-v4-flash' }),
      assistantEvent(6, t0 + 5000, 2, 1, { inputTokens: 10, outputTokens: 5 }),
      turnEndEvent(7, t0 + 9000, 1, 'completed'),
    ]

    collector.backfill('session-1', t0, events)

    const requests = store.requestsForSession('session-1')
    assert.equal(requests.length, 2)
    assert.equal(requests[0]?.provider, 'deepseek')
    assert.equal(requests[0]?.model, 'deepseek-v4-pro')
    assert.equal(requests[0]?.reasoningEffort, 'high')
    assert.equal(requests[0]?.inputTokens, 100)
    assert.equal(requests[0]?.cacheReadTokens, 200)
    assert.equal(requests[0]?.outputTokens, 50)
    assert.equal(requests[0]?.reasoningTokens, 10)
    assert.equal(requests[1]?.model, 'deepseek-v4-flash')

    const calls = store.toolCallsForSession('session-1')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.name, 'web_search')
    assert.equal(calls[0]?.callId, 'call-1')
    assert.equal(calls[0]?.resultSeq, 4)
    assert.equal(calls[0]?.isError, true)
    const turns = store.turnsForSession('session-1')
    assert.equal(turns.length, 1)
    assert.equal(turns[0]?.turn, 1)
    assert.equal(turns[0]?.startTime, t0)
    assert.equal(turns[0]?.endTime, t0 + 9000)
    assert.equal(turns[0]?.durationMs, 9000)
    assert.equal(turns[0]?.reason, 'completed')
    assert.equal(store.lastSeq('session-1'), 7)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('re-folding the same events is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-analytics-'))
  const store = new AnalyticsStore(join(dir, 'test.sqlite'))
  try {
    const collector = new UsageCollector(store)
    const t0 = Date.parse('2026-08-01T10:00:00Z')
    const events: SessionEvent[] = [
      headerEvent(0, t0, { provider: 'deepseek', model: 'deepseek-v4-pro' }),
      assistantEvent(1, t0 + 1000, 1, 1, { inputTokens: 100, outputTokens: 50 }),
    ]
    collector.backfill('session-1', t0, events)
    collector.backfill('session-1', t0, events)
    assert.equal(store.requestsForSession('session-1').length, 1)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('live appends are skipped once consumed by the cursor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-analytics-'))
  const store = new AnalyticsStore(join(dir, 'test.sqlite'))
  try {
    const collector = new UsageCollector(store)
    const t0 = Date.parse('2026-08-01T10:00:00Z')
    const events: SessionEvent[] = [
      headerEvent(0, t0, { provider: 'deepseek', model: 'deepseek-v4-pro' }),
      assistantEvent(1, t0 + 1000, 1, 1, { inputTokens: 100, outputTokens: 50 }),
    ]
    collector.backfill('session-1', t0, events)
    collector.observeEvent('session-1', assistantEvent(1, t0 + 1000, 1, 1, { inputTokens: 100, outputTokens: 50 }))
    assert.equal(store.requestsForSession('session-1').length, 1)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('requests without a prior header stay unpriced and unidentified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-analytics-'))
  const store = new AnalyticsStore(join(dir, 'test.sqlite'))
  try {
    const collector = new UsageCollector(store)
    const t0 = Date.parse('2026-08-01T10:00:00Z')
    collector.backfill('session-1', t0, [assistantEvent(0, t0, 1, 1, { inputTokens: 10, outputTokens: 5 })])
    const requests = store.requestsForSession('session-1')
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.provider, '')
    assert.equal(requests[0]?.model, '')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
