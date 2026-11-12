import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { findCodexSessionRecord } from './codex-session-record'
import { z } from 'zod'
import { CodexUsageLimits } from '../../codex/codex-usage-limits'
import type { AgentSessionUsageLimit } from '../../../shared/agent-session-usage-limit'

const TAIL_BYTES = 256 * 1024
const Window = z.object({
  used_percent: z.number().nullable().optional(),
  window_minutes: z.number().nullable().optional(),
  resets_at: z.number().nullable().optional()
})
const LimitRecord = z.object({
  type: z.literal('event_msg'),
  payload: z.object({
    type: z.literal('token_count'),
    rate_limits: z.object({
      limit_id: z.string().nullable().optional(),
      primary: Window.nullable().optional(),
      secondary: Window.nullable().optional(),
      rate_limit_reached_type: z.string().nullable().optional()
    })
  })
})

function appServerWindow(window: z.infer<typeof Window> | null | undefined) {
  return window == null
    ? window
    : {
        usedPercent: window.used_percent,
        windowDurationMins: window.window_minutes,
        resetsAt: window.resets_at
      }
}

function interpretTail(tail: string, now: number): AgentSessionUsageLimit | undefined {
  const limits = new CodexUsageLimits(() => now)
  for (const line of tail.split('\n')) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    // Strip everything except the permitted rate-limit fields at the parse boundary.
    const parsed = LimitRecord.safeParse(value)
    if (!parsed.success) {
      continue
    }
    const rate = parsed.data.payload.rate_limits
    limits.observe('notification:account/rateLimits/updated', {
      rateLimits: {
        limitId: rate.limit_id,
        primary: appServerWindow(rate.primary),
        secondary: appServerWindow(rate.secondary),
        rateLimitReachedType: rate.rate_limit_reached_type
      }
    })
  }
  const limit = limits.failure({ error: { codexErrorInfo: 'usageLimitExceeded' } })?.usageLimit
  return limit
    ? {
        ...(limit.window ? { window: limit.window } : {}),
        ...(limit.resetsAt !== undefined ? { resetsAt: limit.resetsAt } : {})
      }
    : undefined
}

/** Optional evidence only: one read-only rollout tail, no content or path in the result/errors. */
export async function readCodexRolloutLimit(input: {
  accountHome?: string
  threadId?: string
  startedAt: number
  now?: () => number
}): Promise<AgentSessionUsageLimit | undefined> {
  try {
    const now = (input.now ?? Date.now)()
    if (
      !input.accountHome ||
      !path.isAbsolute(input.accountHome) ||
      !input.threadId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.threadId) ||
      !Number.isFinite(input.startedAt) ||
      !Number.isFinite(now) ||
      input.startedAt > now
    ) {
      return undefined
    }
    const file = await findCodexSessionRecord({
      accountHome: input.accountHome,
      threadId: input.threadId,
      startedAt: input.startedAt,
      now
    })
    if (!file) {
      return undefined
    }
    const expected = await stat(file)
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const info = await handle.stat()
      if (
        !info.isFile() ||
        info.dev !== expected.dev ||
        info.ino !== expected.ino ||
        (await realpath(file)) !== file
      ) {
        return undefined
      }
      const start = Math.max(0, info.size - TAIL_BYTES)
      const buffer = Buffer.alloc(Math.min(info.size, TAIL_BYTES))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      const tail = buffer.subarray(0, bytesRead).toString('utf8')
      // A truncated first line may be conversation text or partial JSON; never parse it.
      const newline = tail.indexOf('\n')
      return interpretTail(start > 0 ? (newline === -1 ? '' : tail.slice(newline + 1)) : tail, now)
    } finally {
      await handle.close()
    }
  } catch {
    // Missing, unreadable, malformed or incompatible evidence preserves the text-only failure.
    return undefined
  }
}
