/**
 * SQLite persistence for collected usage and the pricing table.
 *
 * The store is the plugin's only mutable state. All writes are idempotent
 * upserts keyed by durable session-log seqs, so live collection and replay
 * backfill can both observe the same event without double counting. The
 * schema lives entirely inside this module; there is no migration chain yet
 * (the plugin is pre-1.0 and the on-disk format may change).
 *
 * @module dsh-analytics/store
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PricingRow, ToolCallRecord, UsageRecord } from './types.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dsh_analytics_sessions (
  session_id TEXT PRIMARY KEY,
  cwd TEXT,
  parent_session TEXT,
  created_at INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT -1,
  title TEXT
);
CREATE TABLE IF NOT EXISTS dsh_analytics_requests (
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  step INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT,
  time INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS dsh_analytics_tool_calls (
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  step INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  name TEXT NOT NULL,
  time INTEGER NOT NULL,
  result_seq INTEGER,
  is_error INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS dsh_analytics_pricing (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  region TEXT,
  price_type TEXT NOT NULL,
  input_type TEXT NOT NULL,
  price_per_million REAL NOT NULL,
  currency TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  PRIMARY KEY (provider, model, region, price_type, input_type, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_requests_time ON dsh_analytics_requests (time);
CREATE INDEX IF NOT EXISTS idx_requests_model ON dsh_analytics_requests (provider, model);
CREATE INDEX IF NOT EXISTS idx_requests_session_time ON dsh_analytics_requests (session_id, time);
CREATE INDEX IF NOT EXISTS idx_toolcalls_session ON dsh_analytics_tool_calls (session_id, time);
`

/** A session row returned by reads. */
export interface SessionRow {
  sessionId: string
  cwd?: string
  parentSession?: string
  createdAt: number
  lastSeq: number
  title?: string
}

/** Raw `tool_calls` row before boolean mapping (SQLite stores `is_error` as int). */
interface ToolCallRow {
  sessionId: string
  turn: number
  step: number
  seq: number
  callId: string
  name: string
  time: number
  resultSeq: number | null
  isError: number | null
}

function toToolCallRecord(row: ToolCallRow): ToolCallRecord {
  return {
    sessionId: row.sessionId,
    turn: row.turn,
    step: row.step,
    seq: row.seq,
    callId: row.callId,
    name: row.name,
    time: row.time,
    ...(row.resultSeq === null ? {} : { resultSeq: row.resultSeq }),
    ...(row.isError === null ? {} : { isError: row.isError === 1 }),
  }
}

/**
 * Open the analytics database and prepare the upsert/read statements.
 */
export class AnalyticsStore {
  readonly db: DatabaseSync

  private readonly upsertSessionStmt
  private readonly touchSessionStmt
  private readonly setLastSeqStmt
  private readonly upsertRequestStmt
  private readonly upsertToolCallStmt
  private readonly pairToolResultStmt
  private readonly seedPricingStmt
  private readonly replacePricingStmt
  private readonly loadPricingStmt
  private readonly selectSessionsStmt
  private readonly selectRequestsStmt
  private readonly selectSessionRequestsStmt
  private readonly selectToolCallsStmt
  private readonly selectSessionToolCallsStmt

  /**
   * @param path - filesystem path of the database file; missing directories are created.
   */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)

    this.upsertSessionStmt = this.db.prepare(`
      INSERT INTO dsh_analytics_sessions (session_id, cwd, parent_session, created_at, title)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        cwd = COALESCE(excluded.cwd, dsh_analytics_sessions.cwd),
        parent_session = COALESCE(excluded.parent_session, dsh_analytics_sessions.parent_session),
        title = COALESCE(excluded.title, dsh_analytics_sessions.title)
    `)
    this.touchSessionStmt = this.db.prepare(`
      INSERT OR IGNORE INTO dsh_analytics_sessions (session_id, created_at)
      VALUES (?, ?)
    `)
    this.setLastSeqStmt = this.db.prepare(`
      UPDATE dsh_analytics_sessions SET last_seq = ? WHERE session_id = ?
    `)
    this.upsertRequestStmt = this.db.prepare(`
      INSERT INTO dsh_analytics_requests (
        session_id, turn, step, seq, provider, model, reasoning_effort, time,
        input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, reasoning_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, seq) DO UPDATE SET
        provider = excluded.provider,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        input_tokens = excluded.input_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_tokens = excluded.reasoning_tokens
    `)
    this.upsertToolCallStmt = this.db.prepare(`
      INSERT INTO dsh_analytics_tool_calls (session_id, turn, step, seq, call_id, name, time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, seq) DO UPDATE SET
        name = excluded.name,
        time = excluded.time
    `)
    this.pairToolResultStmt = this.db.prepare(`
      UPDATE dsh_analytics_tool_calls
      SET result_seq = ?, is_error = ?
      WHERE session_id = ? AND call_id = ?
    `)
    this.seedPricingStmt = this.db.prepare(`
      INSERT OR IGNORE INTO dsh_analytics_pricing (
        provider, model, region, price_type, input_type, price_per_million, currency, effective_from, effective_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.replacePricingStmt = this.db.prepare('DELETE FROM dsh_analytics_pricing')
    this.loadPricingStmt = this.db.prepare(`
      SELECT provider, model, region, price_type AS priceType, input_type AS inputType,
             price_per_million AS pricePerMillion, currency, effective_from AS effectiveFrom, effective_to AS effectiveTo
      FROM dsh_analytics_pricing
      ORDER BY provider, model, effective_from
    `)
    this.selectSessionsStmt = this.db.prepare(`
      SELECT session_id AS sessionId, cwd, parent_session AS parentSession, created_at AS createdAt,
             last_seq AS lastSeq, title
      FROM dsh_analytics_sessions
      ORDER BY created_at
    `)
    this.selectRequestsStmt = this.db.prepare(`
      SELECT session_id AS sessionId, turn, step, seq, provider, model,
             reasoning_effort AS reasoningEffort, time,
             input_tokens AS inputTokens, cache_read_tokens AS cacheReadTokens,
             cache_write_tokens AS cacheWriteTokens, output_tokens AS outputTokens,
             reasoning_tokens AS reasoningTokens
      FROM dsh_analytics_requests
      WHERE time >= ? AND time < ?
      ORDER BY time, seq
    `)
    this.selectSessionRequestsStmt = this.db.prepare(`
      SELECT session_id AS sessionId, turn, step, seq, provider, model,
             reasoning_effort AS reasoningEffort, time,
             input_tokens AS inputTokens, cache_read_tokens AS cacheReadTokens,
             cache_write_tokens AS cacheWriteTokens, output_tokens AS outputTokens,
             reasoning_tokens AS reasoningTokens
      FROM dsh_analytics_requests
      WHERE session_id = ?
      ORDER BY time, seq
    `)
    this.selectToolCallsStmt = this.db.prepare(`
      SELECT session_id AS sessionId, turn, step, seq, call_id AS callId, name, time,
             result_seq AS resultSeq, is_error AS isError
      FROM dsh_analytics_tool_calls
      WHERE time >= ? AND time < ?
      ORDER BY time, seq
    `)
    this.selectSessionToolCallsStmt = this.db.prepare(`
      SELECT session_id AS sessionId, turn, step, seq, call_id AS callId, name, time,
             result_seq AS resultSeq, is_error AS isError
      FROM dsh_analytics_tool_calls
      WHERE session_id = ?
      ORDER BY time, seq
    `)
  }

  /** Close the database; the store must not be used afterwards. */
  close(): void {
    this.db.close()
  }

  upsertSession(input: { sessionId: string; cwd?: string; parentSession?: string; createdAt: number; title?: string }): void {
    this.upsertSessionStmt.run(input.sessionId, input.cwd ?? null, input.parentSession ?? null, input.createdAt, input.title ?? null)
  }

  lastSeq(sessionId: string): number {
    const row = this.db.prepare('SELECT last_seq AS lastSeq FROM dsh_analytics_sessions WHERE session_id = ?').get(sessionId) as { lastSeq: number } | undefined
    return row?.lastSeq ?? -1
  }

  setLastSeq(sessionId: string, seq: number): void {
    this.setLastSeqStmt.run(seq, sessionId)
  }

  /** Ensure a session row exists even when the log has no `assistant/message`. */
  touchSession(sessionId: string, createdAt: number): void {
    this.touchSessionStmt.run(sessionId, createdAt)
  }

  sessions(): SessionRow[] {
    return this.selectSessionsStmt.all() as unknown as SessionRow[]
  }

  upsertRequest(record: UsageRecord): void {
    this.upsertRequestStmt.run(
      record.sessionId, record.turn, record.step, record.seq,
      record.provider, record.model, record.reasoningEffort ?? null, record.time,
      record.inputTokens, record.cacheReadTokens, record.cacheWriteTokens,
      record.outputTokens, record.reasoningTokens,
    )
  }

  requests(range: { start: number; end: number }): UsageRecord[] {
    return this.selectRequestsStmt.all(range.start, range.end) as unknown as UsageRecord[]
  }

  requestsForSession(sessionId: string): UsageRecord[] {
    return this.selectSessionRequestsStmt.all(sessionId) as unknown as UsageRecord[]
  }

  upsertToolCall(record: ToolCallRecord): void {
    this.upsertToolCallStmt.run(
      record.sessionId, record.turn, record.step, record.seq,
      record.callId, record.name, record.time,
    )
  }

  pairToolResult(input: { sessionId: string; callId: string; resultSeq: number; isError: boolean }): void {
    this.pairToolResultStmt.run(input.resultSeq, input.isError ? 1 : 0, input.sessionId, input.callId)
  }

  toolCalls(range: { start: number; end: number }): ToolCallRecord[] {
    const rows = this.selectToolCallsStmt.all(range.start, range.end) as unknown as ToolCallRow[]
    return rows.map(toToolCallRecord)
  }

  toolCallsForSession(sessionId: string): ToolCallRecord[] {
    const rows = this.selectSessionToolCallsStmt.all(sessionId) as unknown as ToolCallRow[]
    return rows.map(toToolCallRecord)
  }

  /**
   * Seed the pricing table. With `replace` the table is emptied first
   * (configuration-supplied rows always win); without it, existing rows are
   * kept so a later config change never rewrites already-recorded prices.
   */
  seedPricing(rows: readonly PricingRow[], replace: boolean): void {
    if (replace) this.replacePricingStmt.run()
    for (const row of rows) {
      this.seedPricingStmt.run(
        row.provider, row.model, row.region ?? null, row.priceType, row.inputType,
        row.pricePerMillion, row.currency, row.effectiveFrom, row.effectiveTo ?? null,
      )
    }
  }

  loadPricing(): PricingRow[] {
    return this.loadPricingStmt.all() as unknown as PricingRow[]
  }
}
