import { describe, expect, it } from 'vitest'
import { AttemptFailureSchema, FailureClassSchema } from './attempt-failure'

const failure = { class: 'usage_limit', retryable: true, source: 'structured' }
const resetsAt = '2026-11-09T14:00:00.000Z'

describe('Attempt failure contract', () => {
  it('pins the six failure classes', () => {
    expect(FailureClassSchema.options).toEqual([
      'usage_limit',
      'provider_error',
      'transport_error',
      'permission_error',
      'validation_error',
      'unknown'
    ])
  })

  it.each(['session', 'weekly', 'weeklyModel', 'credits'])(
    'accepts a usage limit with the %s window and an ISO reset',
    (window) => {
      const value = { ...failure, window, resetsAt }
      expect(AttemptFailureSchema.parse(value)).toEqual(value)
    }
  )

  it.each(['provider_error', 'transport_error', 'permission_error', 'validation_error', 'unknown'])(
    'rejects a reset on %s',
    (failureClass) => {
      expect(
        AttemptFailureSchema.safeParse({ ...failure, class: failureClass, resetsAt }).success
      ).toBe(false)
    }
  )

  it.each([
    { class: 'timeout' },
    { retryable: 'yes' },
    { source: 'model' },
    { resetsAt: 'tomorrow' },
    { window: 'daily' },
    { detail: 'unrequested provider prose' }
  ])('rejects invalid or unknown fields: %j', (patch) => {
    expect(AttemptFailureSchema.safeParse({ ...failure, ...patch }).success).toBe(false)
  })

  it('accepts absent and text evidence without a reset', () => {
    for (const source of ['absent', 'text']) {
      const value = { class: 'unknown', retryable: false, source }
      expect(AttemptFailureSchema.parse(value)).toEqual(value)
    }
  })
})
