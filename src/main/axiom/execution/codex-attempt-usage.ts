import path from 'node:path'
import { z } from 'zod'
import { emptyTokenUsage, type TokenUsageReading } from '../../../shared/axiom-contract/token-usage'
import {
  normalizeRawUsage,
  resolveCodexUsageDelta,
  buildCodexUsageEventKey,
  type CodexUsageRawUsage
} from '../../codex-usage/codex-usage-token-delta'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import type { AttemptBinding, RecoveryContext } from '../recovery/attempt-recovery-effects'
import { readAttemptAccount } from './attempt-account'
import { firstThreadStarted, readAttemptSession, sessionOriginStartedAt } from './in-place-session'
import { findCodexSessionRecord } from './codex-session-record'
import { headlessAttemptDirectory } from './headless-attempt-files'
import { CODEX_USAGE_BYTES, CLAUDE_USAGE_BYTES, readTokenUsageFile } from './token-usage-file'

const count = z.number().int().nonnegative()
const Usage = z.object({
  input_tokens: count,
  cached_input_tokens: count.default(0),
  cache_write_input_tokens: count.default(0),
  output_tokens: count,
  reasoning_output_tokens: count.default(0),
  total_tokens: count.default(0)
})
const Info = z.object({
  total_token_usage: Usage.nullable().default(null),
  last_token_usage: Usage.nullable().default(null)
})
const Envelope = z.object({
  timestamp: z.iso.datetime({ offset: true }),
  payload: z.object({ type: z.literal('token_count'), info: z.unknown().optional() })
})
// All unknown fields are stripped at this boundary, including everything beside usage in payload.
const Record = Envelope.extend({
  payload: z.object({ type: z.literal('token_count'), info: Info.nullable() })
})
type Context = Pick<RecoveryContext, 'db' | 'store' | 'now'>

async function source(ctx: Context, binding: AttemptBinding, current: boolean) {
  const attemptId = binding.dispatchId
  if (!attemptId) {
    return undefined
  }
  const worker = ctx.db.getWorkerDispatch(attemptId)
  const account = readAttemptAccount(ctx.store, binding.missionId, attemptId, 'codex')
  const session = readAttemptSession(ctx.store, binding.missionId, attemptId)
  const events = session
    ? undefined
    : await readTokenUsageFile(
        path.join(headlessAttemptDirectory(attemptId), 'events.jsonl'),
        CLAUDE_USAGE_BYTES,
        false
      ).catch(() => undefined)
  const threadId = session?.id ?? firstThreadStarted(events?.text ?? '').id
  if (!account || !threadId || !worker) {
    return undefined
  }
  const start = Date.parse(exposeUtcTimestamp(worker.created_at) ?? '')
  const next = ctx.store
    .listAttemptBindings({ missionId: binding.missionId, taskId: binding.taskId })
    .find((row) => row.seq > binding.seq)
  const nextSession = next?.dispatchId
    ? readAttemptSession(ctx.store, binding.missionId, next.dispatchId)
    : undefined
  const nextDispatch =
    nextSession?.id === threadId && next?.dispatchId
      ? ctx.db.getWorkerDispatch(next.dispatchId)
      : undefined
  const end = nextDispatch
    ? Date.parse(exposeUtcTimestamp(nextDispatch.created_at) ?? '')
    : Infinity
  const file = await findCodexSessionRecord({
    accountHome: account.home,
    threadId,
    startedAt: sessionOriginStartedAt(ctx.db, ctx.store, binding, session),
    now: current ? ctx.now() : Date.parse(exposeUtcTimestamp(worker.updated_at) ?? '')
  }).catch(() => undefined)
  if (!file || !Number.isFinite(start) || Number.isNaN(end)) {
    return undefined
  }
  return { file, start, end }
}

function measure(text: string, cut: boolean, start: number, end: number): TokenUsageReading {
  const result = emptyTokenUsage('complete')
  let previous: CodexUsageRawUsage | null = null
  let firstTimestamp: number | undefined
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"token_count"')) {
      continue
    }
    let inside = true
    try {
      const raw: unknown = JSON.parse(line)
      const envelope = Envelope.safeParse(raw)
      if (!envelope.success) {
        result.status = 'partial'
        continue
      }
      const timestamp = Date.parse(envelope.data.timestamp)
      firstTimestamp ??= timestamp
      inside = timestamp >= start && timestamp < end
      const record = Record.parse(raw)
      const info = record.payload.info
      if (!info?.last_token_usage && inside) {
        result.status = 'partial'
      }
      const total = normalizeRawUsage(info?.total_token_usage)
      const last = normalizeRawUsage(info?.last_token_usage)
      const key = buildCodexUsageEventKey(record.timestamp, total, last)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      const resolved = resolveCodexUsageDelta(total, last, previous)
      if (!resolved) {
        continue
      }
      previous = resolved.nextTotals
      // Session totals establish continuity only: they never become an Attempt increment.
      if (!inside || !last || !info?.last_token_usage || resolved.kind !== 'event') {
        continue
      }
      const delta = resolved.delta
      result.newTokens +=
        Math.max(0, delta.inputTokens - delta.cachedInputTokens) + delta.outputTokens
      result.inputTokens += delta.inputTokens
      result.cachedInputTokens += delta.cachedInputTokens
      result.cacheWriteTokens += info.last_token_usage.cache_write_input_tokens
      result.outputTokens += delta.outputTokens
      result.reasoningTokens += delta.reasoningOutputTokens
    } catch {
      if (inside) {
        result.status = 'partial'
      }
    }
  }
  if (cut && (firstTimestamp === undefined || start < firstTimestamp)) {
    result.status = 'partial'
  }
  return result
}

export async function readCodexAttemptUsage(
  ctx: Context,
  binding: AttemptBinding,
  current: boolean
): Promise<TokenUsageReading> {
  const selected = await source(ctx, binding, current)
  if (!selected) {
    return emptyTokenUsage('unavailable')
  }
  try {
    const file = await readTokenUsageFile(selected.file, CODEX_USAGE_BYTES, true)
    return file
      ? measure(file.text, file.cut, selected.start, selected.end)
      : emptyTokenUsage('unavailable')
  } catch {
    return emptyTokenUsage('unavailable')
  }
}
