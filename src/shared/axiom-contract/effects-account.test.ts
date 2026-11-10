import { expect, it } from 'vitest'
import { AttemptContinuePayloadSchema } from './effects'
import { ProviderFilterReasonSchema } from './agent-spec'

const legacy = { taskId: 'task', seq: 1, chain: 1, failureClass: 'usage_limit' }
it('keeps legacy continuation payloads valid and adds a strict optional account', () => {
  expect(AttemptContinuePayloadSchema.parse(legacy)).toEqual(legacy)
  const payload = { ...legacy, account: { provider: 'codex', key: 'opaque' } }
  expect(AttemptContinuePayloadSchema.parse(payload)).toEqual(payload)
  for (const account of [
    { provider: 'codex', key: '' },
    { provider: 'unknown', key: 'k' },
    { provider: 'codex', key: 'k', path: '/home' }
  ]) {
    expect(AttemptContinuePayloadSchema.safeParse({ ...legacy, account }).success).toBe(false)
  }
})
it('appends account cooldown after every existing filter reason', () => {
  expect(ProviderFilterReasonSchema.options).toEqual([
    'not_installed',
    'no_account',
    'not_certified',
    'disallowed',
    'tier_too_low',
    'account_cooldown'
  ])
})
