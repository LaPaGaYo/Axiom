import { describe, expect, it, vi } from 'vitest'
import { ClaudeUsageLimits } from '../../claude/claude-usage-limits'
import { classifyHeadlessFailure } from './attempt-failure-classification'

const now = Date.parse('2026-11-09T12:00:00.000Z')
const hour = 60 * 60 * 1000
const jsonl = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n')
const result = (fields: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  ...fields
})
const rate = (reset = now + hour, rateLimitType = 'five_hour') => ({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'rejected', rateLimitType, resetsAt: reset / 1000 }
})
const refusal = { type: 'assistant', error: 'rate_limit', api_error: 'usage_limit_reached' }
const usage = { class: 'usage_limit', retryable: true, source: 'structured' }
const unknown = { class: 'unknown', retryable: false, source: 'absent' }
const classifyClaude = (...events: unknown[]) =>
  classifyHeadlessFailure({ provider: 'claude', eventsText: jsonl(...events), now })

describe('structured Claude failure classification', () => {
  it('classifies a Claude usage limit from structured events', () => {
    expect(classifyClaude(rate(), refusal, result())).toEqual({
      kind: 'interrupted',
      failure: { ...usage, window: 'session', resetsAt: '2026-11-09T13:00:00.000Z' }
    })
  })

  it.each([
    ['authentication_failed', 'permission_error', false, 'interrupted'],
    ['oauth_org_not_allowed', 'permission_error', false, 'interrupted'],
    ['account_on_hold', 'permission_error', false, 'interrupted'],
    ['verification_required', 'permission_error', false, 'interrupted'],
    ['cloud_credential_error', 'permission_error', false, 'interrupted'],
    ['billing_error', 'usage_limit', false, 'interrupted'],
    ['overloaded', 'provider_error', true, 'interrupted'],
    ['server_error', 'provider_error', true, 'interrupted'],
    ['invalid_request', 'validation_error', false, 'failed'],
    ['model_not_found', 'validation_error', false, 'failed'],
    ['max_output_tokens', 'validation_error', false, 'failed']
  ])('classifies assistant error %s', (error, failureClass, retryable, kind) => {
    expect(classifyClaude({ type: 'assistant', error }, result())).toEqual({
      kind,
      failure: { class: failureClass, retryable, source: 'structured' }
    })
  })

  it.each([
    [408, 'provider_error', true, 'interrupted'],
    [409, 'provider_error', true, 'interrupted'],
    [500, 'provider_error', true, 'interrupted'],
    [503, 'provider_error', true, 'interrupted'],
    [400, 'validation_error', false, 'failed'],
    [404, 'validation_error', false, 'failed'],
    [413, 'validation_error', false, 'failed'],
    [422, 'validation_error', false, 'failed'],
    [401, 'permission_error', false, 'interrupted'],
    [403, 'permission_error', false, 'interrupted']
  ])('classifies failed result status %s', (api_error_status, failureClass, retryable, kind) => {
    expect(classifyClaude(result({ api_error_status }))).toEqual({
      kind,
      failure: { class: failureClass, retryable, source: 'structured' }
    })
  })

  it('classifies the structured prompt-too-long terminal reason', () => {
    expect(classifyClaude(result({ terminal_reason: 'prompt_too_long' }))).toEqual({
      kind: 'failed',
      failure: { class: 'validation_error', retryable: false, source: 'structured' }
    })
  })

  it('requires failed results before interpreting their status', () => {
    expect(
      classifyClaude(result({ subtype: 'success', is_error: false, api_error_status: 503 }))
    ).toEqual({ kind: 'failed', failure: unknown })
  })

  it('uses the classification table priority across events and ahead of text', () => {
    const errors = ['invalid_request', 'overloaded', 'billing_error', 'authentication_failed']
    const events = errors.map((error) => ({ type: 'assistant', error }))
    expect(
      classifyClaude(...events, result({ result: 'usage limit', api_error_status: 403 }))
    ).toEqual({
      kind: 'interrupted',
      failure: { class: 'permission_error', retryable: false, source: 'structured' }
    })
    expect(classifyClaude(...events, refusal, result())).toEqual({
      kind: 'interrupted',
      failure: usage
    })
  })

  it('takes the latest required reset across multiple refusing limits', () => {
    expect(classifyClaude(rate(), rate(now + 2 * hour, 'seven_day'), refusal, result())).toEqual({
      kind: 'interrupted',
      failure: { ...usage, resetsAt: '2026-11-09T14:00:00.000Z' }
    })
  })

  it.each([
    ['seven_day', 'weekly'],
    ['seven_day_opus', 'weeklyModel'],
    ['overage', 'credits']
  ])('uses the kernel window for %s', (rateLimitType, window) => {
    expect(classifyClaude(rate(now + hour, rateLimitType), refusal).failure).toEqual({
      ...usage,
      window,
      resetsAt: '2026-11-09T13:00:00.000Z'
    })
  })

  it.each([now - 1000, now, now + 8 * 24 * hour + 1000])(
    'drops an unusable reset at %s',
    (reset) => {
      expect(classifyClaude(rate(reset), refusal).failure.resetsAt).toBeUndefined()
    }
  )

  it('accepts a reset exactly eight days ahead', () => {
    expect(classifyClaude(rate(now + 8 * 24 * hour), refusal).failure.resetsAt).toBe(
      '2026-11-17T12:00:00.000Z'
    )
  })

  it('lets the kernel consume inline quota metadata from assistant events', () => {
    expect(classifyClaude({ ...refusal, api_error_params: rate() }).failure).toEqual({
      ...usage,
      window: 'session',
      resetsAt: '2026-11-09T13:00:00.000Z'
    })
  })

  it('retains untyped assistant evidence for a refusal whose rate event arrives later', () => {
    expect(
      classifyClaude(
        { type: 'assistant', error: 'rate_limit' },
        rate(),
        result({ api_error_status: 429 })
      )
    ).toEqual({
      kind: 'interrupted',
      failure: { ...usage, window: 'session', resetsAt: '2026-11-09T13:00:00.000Z' }
    })
  })

  it('does not infer quota from a typed different cause or bare status', () => {
    expect(
      classifyClaude(
        rate(),
        { type: 'assistant', error: 'rate_limit', api_error: 'model_requires_usage_credits' },
        result({ api_error_status: 429 })
      )
    ).toEqual({ kind: 'failed', failure: unknown })
    expect(classifyClaude(rate(), result({ api_error_status: 429 }))).toEqual({
      kind: 'failed',
      failure: unknown
    })
  })

  it('keeps a failed turn without a recognised cause as failed', () => {
    expect(
      classifyClaude({ type: 'assistant', error: 'unknown' }, result({ result: 'Task failed' }))
    ).toEqual({ kind: 'failed', failure: unknown })
  })

  it('does not classify assistant prose as error evidence', () => {
    expect(
      classifyClaude(
        { type: 'assistant', message: { content: [{ type: 'text', text: 'quota auth 429 401' }] } },
        result()
      )
    ).toEqual({ kind: 'failed', failure: unknown })
  })
})

describe('headless text and absent failure evidence', () => {
  it.each(['codex', 'claude'])('keeps both exact legacy pattern halves for %s', (provider) => {
    const patterns = [
      [
        'quota',
        'rate limit',
        'ratelimit',
        'rate-limit',
        'usage limit',
        'insufficient credit',
        '429'
      ],
      [
        'auth',
        'authentication',
        'authorization',
        'unauthorized',
        'unauthorised',
        'login',
        'log in',
        'logged in',
        'invalid token',
        '401'
      ]
    ]
    for (const [index, messages] of patterns.entries()) {
      for (const message of messages) {
        const event =
          provider === 'claude'
            ? result({ result: message })
            : { type: 'turn.failed', error: { message } }
        expect(classifyHeadlessFailure({ provider, eventsText: jsonl(event), now })).toEqual({
          kind: 'interrupted',
          failure: {
            class: index === 0 ? 'usage_limit' : 'permission_error',
            retryable: true,
            source: 'text'
          }
        })
      }
    }
  })

  it.each(['fixture work failed', 'Fixture Worker crashed'])(
    'keeps the existing scenario %s failed',
    (message) => {
      expect(
        classifyHeadlessFailure({
          provider: 'codex',
          eventsText: jsonl({ type: 'turn.failed', error: { message } }),
          now
        })
      ).toEqual({ kind: 'failed', failure: unknown })
    }
  )

  it('keeps the existing preference for turn.failed over later error notices', () => {
    expect(
      classifyHeadlessFailure({
        provider: 'codex',
        eventsText: jsonl(
          { type: 'turn.failed', error: { message: 'Task failed' } },
          { type: 'error', message: 'login required' }
        ),
        now
      })
    ).toEqual({ kind: 'failed', failure: unknown })
  })

  it.each(['codex', 'claude'])(
    'classifies absent events as a retryable interruption for %s',
    (provider) => {
      for (const eventsText of ['', 'not json\nnull\n[]\n123']) {
        expect(classifyHeadlessFailure({ provider, eventsText, now })).toEqual({
          kind: 'interrupted',
          failure: { class: 'unknown', retryable: true, source: 'absent' }
        })
      }
    }
  )

  it('falls back to the text patterns when the structured pass throws', () => {
    const observe = vi.spyOn(ClaudeUsageLimits.prototype, 'observe').mockImplementationOnce(() => {
      throw new Error('classifier failed')
    })
    try {
      expect(classifyClaude(rate(), result({ errors: ['Usage limit reached'] }))).toEqual({
        kind: 'interrupted',
        failure: { class: 'usage_limit', retryable: true, source: 'text' }
      })
    } finally {
      observe.mockRestore()
    }
  })
})

it.each([
  [{ type: 'rate_limit_event' }],
  [{ type: 'assistant', error: 'unknown' }],
  [result({ errors: ['Task failed'] })]
])('retains event evidence when the structured pass throws (%j)', (event) => {
  const observe = vi.spyOn(ClaudeUsageLimits.prototype, 'observe').mockImplementation(() => {
    throw new Error('malformed structured input')
  })
  try {
    expect(classifyClaude(event)).toEqual({ kind: 'failed', failure: unknown })
  } finally {
    observe.mockRestore()
  }
})
