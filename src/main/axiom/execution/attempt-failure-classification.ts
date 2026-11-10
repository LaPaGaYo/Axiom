import type { AttemptFailure } from '../../../shared/axiom-contract/attempt-failure'
import {
  ClaudeUsageLimits,
  type ClaudeUsageLimitEvidence,
  type ClaudeUsageLimitRow
} from '../../claude/claude-usage-limits'
import { parseHeadlessWorkerEvents } from './headless-worker-events'
import { INTERRUPTION_MAX_RESET_MS } from './interruption-policy'

const QUOTA_TEXT = /quota|rate.?limit|usage limit|insufficient.credit|429/i
const PERMISSION_TEXT =
  /auth(?:entication|orization)?|unauthori[sz]ed|login|log(?:ged)? in|invalid.token|401/i
const PERMISSION_ERRORS = [
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'cloud_credential_error'
]

function usageFailure(row: ClaudeUsageLimitRow, now: number): AttemptFailure {
  const limit = row.failure?.usageLimit
  const reset = limit?.resetsAt
  return {
    class: 'usage_limit',
    retryable: true,
    source: 'structured',
    ...(limit?.window ? { window: limit.window } : {}),
    ...(reset !== undefined && now < reset && reset <= now + INTERRUPTION_MAX_RESET_MS
      ? { resetsAt: new Date(reset).toISOString() }
      : {})
  }
}

function claudeFailure(
  messages: Record<string, unknown>[],
  now: number
): AttemptFailure | undefined {
  const limits = new ClaudeUsageLimits(() => now)
  const errors = new Set<string>()
  const statuses = new Set<number>()
  let evidence: ClaudeUsageLimitEvidence | null = null
  let usage: AttemptFailure | undefined
  let promptTooLong = false
  for (const message of messages) {
    limits.observe(message)
    const root = message.parent_tool_use_id == null
    if (message.type === 'assistant') {
      if (typeof message.error === 'string') {
        errors.add(message.error)
      }
      const typed = typeof message.api_error === 'string' && message.api_error.length > 0
      // A typed non-quota cause cannot become quota through an untyped follow-up frame.
      const row = root && !typed && evidence?.cause === 'other' ? null : limits.assistant(message)
      if (row) {
        usage = usageFailure(row, now)
      }
      if (root && typed) {
        evidence = { cause: message.api_error === 'usage_limit_reached' ? 'quota' : 'other' }
      } else if (root && message.error === 'rate_limit' && evidence?.cause !== 'other') {
        evidence = row ? { cause: 'quota' } : (evidence ?? { cause: 'untyped' })
      }
    }
    if (message.type === 'result') {
      const failed =
        message.is_error === true ||
        (typeof message.subtype === 'string' && message.subtype.startsWith('error_'))
      const row = root ? limits.result(message, failed, evidence) : null
      if (row) {
        usage = usageFailure(row, now)
      }
      if (failed) {
        if (typeof message.api_error_status === 'number') {
          statuses.add(message.api_error_status)
        }
        if (message.terminal_reason === 'prompt_too_long') {
          promptTooLong = true
        }
      }
      if (root) {
        evidence = null
      }
    }
  }
  let failure: AttemptFailure | undefined
  if (usage) {
    failure = usage
  } else if (PERMISSION_ERRORS.some((error) => errors.has(error))) {
    failure = { class: 'permission_error', retryable: false, source: 'structured' }
  } else if (errors.has('billing_error')) {
    failure = { class: 'usage_limit', retryable: false, source: 'structured' }
  } else if (
    ['overloaded', 'server_error'].some((error) => errors.has(error)) ||
    [...statuses].some((status) => status === 408 || status === 409 || status >= 500)
  ) {
    failure = { class: 'provider_error', retryable: true, source: 'structured' }
  } else if (
    ['invalid_request', 'model_not_found', 'max_output_tokens'].some((error) =>
      errors.has(error)
    ) ||
    [400, 404, 413, 422].some((status) => statuses.has(status)) ||
    promptTooLong
  ) {
    failure = { class: 'validation_error', retryable: false, source: 'structured' }
  } else if (statuses.has(401) || statuses.has(403)) {
    failure = { class: 'permission_error', retryable: false, source: 'structured' }
  }
  return failure
}

function claudeVerdict(eventsText: string, now: number) {
  const messages = eventsText.split(/\r?\n/).flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line)
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? [{ ...value }]
        : []
    } catch {
      return []
    }
  })
  const hasEvents = messages.some(
    (message) =>
      'type' in message && (message.type === 'assistant' || message.type === 'rate_limit_event')
  )
  try {
    return { failure: claudeFailure(messages, now), hasEvents }
  } catch {
    // A malformed structured signal cannot suppress the text fallback or event evidence.
    return { failure: undefined, hasEvents }
  }
}

function absentInterruption(): { kind: 'interrupted'; failure: AttemptFailure } {
  return { kind: 'interrupted', failure: { class: 'unknown', retryable: true, source: 'absent' } }
}

export function classifyHeadlessFailure(input: {
  eventsText: string
  provider: string
  now?: number
}): { kind: 'interrupted' | 'failed'; failure: AttemptFailure } {
  try {
    const now = input.now ?? Date.now()
    const events = parseHeadlessWorkerEvents(input.eventsText, input.provider)
    const claude = input.provider === 'claude' ? claudeVerdict(input.eventsText, now) : undefined
    let failure = claude?.failure
    if (!failure && QUOTA_TEXT.test(events.lastError ?? '')) {
      failure = { class: 'usage_limit', retryable: true, source: 'text' }
    }
    if (!failure && PERMISSION_TEXT.test(events.lastError ?? '')) {
      failure = { class: 'permission_error', retryable: true, source: 'text' }
    }
    if (failure) {
      return { kind: failure.class === 'validation_error' ? 'failed' : 'interrupted', failure }
    }
    return events.hasEvents || claude?.hasEvents
      ? { kind: 'failed', failure: { class: 'unknown', retryable: false, source: 'absent' } }
      : absentInterruption()
  } catch {
    return absentInterruption()
  }
}
