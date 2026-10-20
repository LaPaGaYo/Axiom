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

it('retains the real terminal resource after settlement commits and before SUBMISSION mail', async () => {
  f.retain.mockRestore()
  const retain = f.db.retainWorkerTerminalResource.bind(f.db)
  vi.spyOn(f.db, 'retainWorkerTerminalResource').mockImplementationOnce((attemptId) => {
    expect(f.db.db.isTransaction).toBe(false)
    expect(f.store.getSubmissionByDispatch(attemptId)).toBeDefined()
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
    expect(f.db.getDispatchContextById(attemptId)?.status).toBe('completed')
    expect(f.store.listVerificationRuns({ missionId: f.mission.id })).toHaveLength(1)
    expect(f.store.listMessages({ missionId: f.mission.id })).toHaveLength(0)
    return retain(attemptId)
  })
  const result = await f.submit()
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  expect(f.db.getWorkerTerminalResourceByOwner(f.t01.attemptId)?.release_state).toBe('retained')
  const events = f.store.listAuditEvents({ missionId: f.mission.id })
  const submitted = events.find((event) => event.event === 'attempt.submitted')!
  const retained = events.find((event) => event.event === 'attempt.terminal_retained')!
  const sent = events.find((event) => event.event === 'message.sent')!
  expect(retained).toMatchObject({
    objectKind: 'attempt',
    objectId: f.t01.attemptId,
    after: { retainDisposition: 'retained' }
  })
  expect(submitted.sequence).toBeLessThan(retained.sequence)
  expect(retained.sequence).toBeLessThan(sent.sequence)
})
it.each([2000, 2001, 4000])(
  'stores a %i-character report summary and bounds SUBMISSION mail',
  async (length) => {
    const summary = 'x'.repeat(length)
    const result = await f.call(
      'axiom.attempt.submit',
      {
        ...f.params(),
        report: { ...report, summary }
      },
      { orchestrationCapability: f.t01.capability }
    )
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(f.store.getSubmissionByDispatch(f.t01.attemptId)?.report.summary).toBe(summary)
    expect(f.store.listMessages({ missionId: f.mission.id })[0]?.summary).toBe(
      length > 2000 ? `${'x'.repeat(1999)}…` : summary
    )
  }
)
it('SUBMISSION mail relates the immutable Submission id', async () => {
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
