import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture, report } from './submission-fixture.test-support'
import { AttemptSubmitResponseSchema } from '../../../shared/axiom-contract/attempt-params'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  f.db.close()
  vi.restoreAllMocks()
})

it('archives after settlement and verification kick, before mail and receipt, then releases after grace', async () => {
  f.capture.mockImplementationOnce(async (input) => {
    expect(f.db.db.isTransaction).toBe(false)
    expect(f.store.getSubmissionByDispatch(input.dispatchId)).toBeDefined()
    expect(f.kick).toHaveBeenCalledOnce()
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
    expect(f.db.getDispatchContextById(input.dispatchId)?.status).toBe('completed')
    expect(f.store.listVerificationRuns({ missionId: f.mission.id })).toHaveLength(1)
    expect(f.store.listMessages({ missionId: f.mission.id })).toHaveLength(0)
    return {
      kind: 'terminal_tail',
      status: 'captured',
      content: {
        lines: ['Output'],
        truncated: false,
        terminalStatus: 'running',
        warnings: []
      }
    }
  })
  const result = await f.submit()
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  expect(f.db.getWorkerTerminalResourceByOwner(f.t01.attemptId)?.release_state).toBe(
    'not_requested'
  )
  const events = f.store.listAuditEvents({ missionId: f.mission.id })
  const submitted = events.find((event) => event.event === 'attempt.submitted')!
  const archived = events.find((event) => event.event === 'attempt.transcript_archived')!
  const sent = events.find((event) => event.event === 'message.sent')!
  expect(archived).toMatchObject({ objectKind: 'attempt', objectId: f.t01.attemptId })
  expect(submitted.sequence).toBeLessThan(archived.sequence)
  expect(archived.sequence).toBeLessThan(sent.sequence)
  expect(
    f.db.db
      .prepare(
        "SELECT * FROM mutation_receipts WHERE method = 'axiom.attempt.submit' AND state = 'completed'"
      )
      .all()
  ).not.toHaveLength(0)
  await f.submit() // An authenticated replay must not schedule another release.
  await vi.advanceTimersByTimeAsync(1999)
  expect(f.releaseWorker).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(f.releaseWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'attempt.terminal_released',
      after: expect.objectContaining({
        submissionId: f.store.getSubmissionByDispatch(f.t01.attemptId)!.id,
        state: 'released',
        processAction: 'closed_agent_terminal',
        archive: { source: 'terminal', status: 'captured' }
      })
    })
  )
})
it('waits for Artifact storage before recording the receipt or arming release', async () => {
  const entered = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const put = f.put.getMockImplementation()!
  f.put.mockImplementationOnce(async (input) => {
    entered.resolve()
    await resume.promise
    return put(input)
  })
  const pending = f.submit()
  await entered.promise
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeDefined()
  expect(f.store.listMessages({ missionId: f.mission.id })).toHaveLength(0)
  expect(
    f.db.db
      .prepare(
        "SELECT * FROM mutation_receipts WHERE method = 'axiom.attempt.submit' AND state = 'completed'"
      )
      .all()
  ).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).not.toHaveBeenCalled()
  resume.resolve()
  expect(await pending).toMatchObject({ ok: true })
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).toHaveBeenCalledOnce()
})
it.each([2000, 2001, 4000])(
  'stores a %i-character report summary and bounds SUBMISSION mail',
  async (length) => {
    const summary = 'x'.repeat(length)
    const result = await f.call('axiom.attempt.submit', {
      ...f.params(),
      report: { ...report, summary }
    })
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
