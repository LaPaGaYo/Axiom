import { rmSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { tokenUsageFixture, usageStart, iso } from './token-usage-fixture.test-support'

const usage = {
  input_tokens: 1000,
  cached_input_tokens: 400,
  cache_write_input_tokens: 100,
  output_tokens: 50,
  reasoning_output_tokens: 10,
  total_tokens: 1050
}
const record = (at = usageStart, counts = usage) => ({
  timestamp: iso(at),
  type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: counts, last_token_usage: counts } }
})
let f: ReturnType<typeof tokenUsageFixture>
beforeEach(() => {
  f = tokenUsageFixture()
})
afterEach(async () => {
  await f.cleanup()
})

it('skips rate-limit-only rollout records without marking the reading partial', async () => {
  const rateLimit = (at: number) => ({
    timestamp: iso(at),
    type: 'event_msg',
    payload: { type: 'token_count', info: null }
  })
  f.rollout([rateLimit(usageStart), record(usageStart + 1), rateLimit(usageStart + 2)])
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 650, status: 'complete', final: 0 }])
})

it('never lowers recorded token usage', async () => {
  const file = f.rollout([record()])
  await f.tick()
  const counts = {
    new_tokens: 650,
    input_tokens: 1000,
    cached_input_tokens: 400,
    cache_write_tokens: 100,
    output_tokens: 50,
    reasoning_tokens: 10
  }
  expect(f.ledger()).toMatchObject([{ ...counts, status: 'complete', final: 0 }])
  f.rollout([
    record(usageStart, {
      input_tokens: 500,
      cached_input_tokens: 200,
      cache_write_input_tokens: 10,
      output_tokens: 20,
      reasoning_output_tokens: 5,
      total_tokens: 520
    })
  ])
  await f.tick()
  expect(f.ledger()).toMatchObject([{ ...counts, status: 'partial', final: 0 }])
  rmSync(file)
  await f.tick()
  expect(f.ledger()).toMatchObject([{ ...counts, status: 'partial', final: 0 }])
  expect(await f.submit()).toMatchObject({ ok: true })
  await f.tick()
  expect(f.ledger()).toMatchObject([{ ...counts, status: 'partial', final: 1 }])
  const final = f.ledger()
  f.rollout([record(usageStart, { ...usage, input_tokens: 2000, total_tokens: 2050 })])
  await f.tick()
  expect(f.ledger()).toEqual(final)
  const stored = f.store.getAttemptTokenUsage(f.t01.attemptId)
  if (!stored) {
    throw new Error('Missing final usage row')
  }
  expect(f.store.upsertAttemptTokenUsage({ ...stored, newTokens: 9999, final: false })).toBe(false)
  expect(f.ledger()).toEqual(final)
})

it('marks an individual count regression partial even when new tokens grow', async () => {
  f.rollout([record()])
  await f.tick()
  f.rollout([
    record(usageStart, {
      ...usage,
      input_tokens: 2000,
      reasoning_output_tokens: 5,
      total_tokens: 2050
    })
  ])
  await f.tick()
  expect(f.ledger()).toMatchObject([
    { new_tokens: 1650, input_tokens: 2000, reasoning_tokens: 10, status: 'partial' }
  ])
})

it('keeps present unusable Codex usage partial', async () => {
  f.rollout([
    record(),
    {
      timestamp: iso(usageStart + 1),
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: usage } }
    }
  ])
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 650, status: 'partial' }])
})
