import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture, report } from './submission-fixture.test-support'
import { AttemptSubmitResponseSchema } from '../../../shared/axiom-contract/attempt-params'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

// These are acceptance tests, not expected failures. The brief requires leaving tests red
// when their fix needs an out-of-scope edit; the exact additions are in M2-07-1.md.
it('scope exception required: real kernel retention nests in the submit transaction', async () => {
  f.retain.mockRestore()
  const result = await f.submit()
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
})
it('scope exception required: a valid 4,000-character report summary reaches SUBMISSION mail', async () => {
  const result = await f.call(
    'axiom.attempt.submit',
    {
      ...f.params(),
      report: { ...report, summary: 'x'.repeat(4000) }
    },
    { orchestrationCapability: f.t01.capability }
  )
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  expect(f.store.listMessages({ missionId: f.mission.id })[0]?.summary).toHaveLength(4000)
})
it('scope exception required: SUBMISSION mail relates the immutable Submission id', async () => {
  const result = await f.submit()
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) {
    throw new Error(result.error.code)
  }
  const { submission } = AttemptSubmitResponseSchema.parse(result.result)
  expect(f.store.listMessages({ missionId: f.mission.id })[0]?.related).toMatchObject({
    submissionId: submission.id
  })
})
