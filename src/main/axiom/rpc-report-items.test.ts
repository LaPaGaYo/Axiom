import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAxiomControlPlane } from './control-plane'
import { reportItemsFixture } from './messaging/report-items-fixture.test-support'

let f: ReturnType<typeof reportItemsFixture>
beforeEach(() => {
  f = reportItemsFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const pending = () => f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })

it('answers a Task question after settlement, preserves whitespace in the audit, and replays only its receipt', async () => {
  const id = f.item('QUESTION', 'Which format?', ['JSON', 'CSV'])
  f.db.settleWorkerReport({
    taskId: f.t01.taskId,
    dispatchId: f.t01.attemptId,
    outcome: 'succeeded',
    result: 'submitted'
  })
  expect(pending()).toMatchObject([
    {
      id,
      question: 'Which format?',
      options: ['JSON', 'CSV'],
      answer: null,
      status: 'pending',
      pending: true
    }
  ])
  const body = '  JSON\n'
  expect(await f.answer(id, body, 'answer-once')).toMatchObject({ ok: true })
  const before = f.snapshot()
  expect(await f.answer(id, body, 'answer-once')).toMatchObject({
    ok: true,
    result: { mutation: { replayed: true } }
  })
  expect(f.snapshot()).toEqual(before)
  for (const text of [body, 'CSV']) {
    expect(await f.answer(id, text)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
  }
  expect(f.snapshot()).toEqual(before)
  expect(pending()).toEqual([])
  expect(f.store.listMessages({ missionId: f.mission.id })).toMatchObject([
    { id, status: 'answered', answer: body, pending: false }
  ])
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'question.answered')
  ).toEqual([
    expect.objectContaining({
      actor: 'user',
      objectKind: 'message',
      objectId: id,
      before: { status: 'pending' },
      after: {
        status: 'answered',
        taskId: f.t01.taskId,
        attemptId: f.t01.attemptId,
        answer: body,
        by: 'user'
      }
    })
  ])
  expect(f.db.getMessageById(id)?.body).toBe('')
  expect(f.db.getQuestion(id)).toBeUndefined()
})

it.each(['typed', 'kernel'])(
  'refuses secrets on the %s answer path without any writes',
  async (kind) => {
    let id: string
    if (kind === 'typed') {
      id = f.item('QUESTION', 'Which format?')
    } else {
      await f.call('axiom.attempt.ask', {
        from: f.t01.from,
        attemptId: f.t01.attemptId,
        question: 'Which format?',
        timeoutMs: 0
      })
      const message = f.db.getUnreadRunMailbox(f.mission.runId)[0]
      if (!message) {
        throw new Error('Question missing')
      }
      id = message.id
    }
    const before = f.snapshot()
    expect(await f.answer(id, `Use ghp_${'x'.repeat(36)}`)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'secret_in_answer' }
    })
    expect(f.snapshot()).toEqual(before)
    expect(pending()).toHaveLength(1)
  }
)

it('bounds typed answers, rejects other messages and foreign Missions, and leaves their state intact', async () => {
  const id = f.item('QUESTION', 'Which format?')
  const followup = f.item('REQUEST', 'Add regression coverage')
  const before = f.snapshot()
  expect(await f.answer(id, 'x'.repeat(4001))).toMatchObject({
    ok: false,
    error: { code: 'invalid_argument' }
  })
  expect(await f.answer(followup, 'Yes')).toMatchObject({
    ok: false,
    error: { code: 'question_not_found' }
  })
  const payload = f.db.getMessageById(id)?.payload
  if (!payload) {
    throw new Error('Question payload missing')
  }
  f.db.db
    .prepare('UPDATE messages SET payload = ? WHERE id = ?')
    .run(payload.replace(f.mission.id, 'foreign'), id)
  expect(await f.answer(id, 'Yes')).toMatchObject({
    ok: false,
    error: { code: 'question_not_found' }
  })
  f.db.db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(payload, id)
  expect(f.snapshot()).toEqual(before)
  expect(await f.answer(id, 'x'.repeat(4000))).toMatchObject({ ok: true })
})

it.each(['accept', 'reject'] as const)(
  'records follow-up %s with a redacted rationale, without creating a Task',
  async (decision) => {
    const id = f.item('REQUEST', 'Add leap-day tests')
    const tasks = f.store.listTaskStages({ missionId: f.mission.id })
    const p = {
      missionId: f.mission.id,
      messageId: id,
      decision,
      rationale: `Reviewed ghp_${'x'.repeat(36)}`
    }
    expect(
      await f.call('axiom.message.resolve', p, { orchestrationRequestId: 'resolve-once' })
    ).toMatchObject({ ok: true })
    const before = f.snapshot()
    expect(
      await f.call('axiom.message.resolve', p, { orchestrationRequestId: 'resolve-once' })
    ).toMatchObject({ ok: true })
    expect(await f.call('axiom.message.resolve', p)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(f.snapshot()).toEqual(before)
    expect(pending()).toEqual([])
    expect(f.store.listTaskStages({ missionId: f.mission.id })).toEqual(tasks)
    expect(
      f.store
        .listAuditEvents({ missionId: f.mission.id })
        .filter((e) => e.event === 'followup.resolved')
    ).toEqual([
      expect.objectContaining({
        objectKind: 'message',
        objectId: id,
        actor: 'user',
        after: {
          decision,
          rationale: 'Reviewed [REDACTED]',
          taskId: f.t01.taskId,
          attemptId: f.t01.attemptId
        }
      })
    ])
  }
)

it('wakes admission after answering even when the Task already is READY', async () => {
  const id = f.item('QUESTION', 'Proceed?')
  f.store.updateTaskStage({ taskId: f.t01.taskId, from: 'RUNNING', to: 'READY' })
  const plane = getAxiomControlPlane(f.runtime)
  const schedule = vi
    .spyOn(plane.scheduler, 'scheduleRound')
    .mockResolvedValue({ admitted: [], skipped: [] })
  expect(await f.answer(id, 'Yes')).toMatchObject({ ok: true })
  expect(schedule).toHaveBeenCalledWith(f.mission.id, 'stage_change')
})

it('does not wake admission or retain an answer when its outer transaction rolls back', async () => {
  const id = f.item('QUESTION', 'Proceed?')
  f.store.updateTaskStage({ taskId: f.t01.taskId, from: 'RUNNING', to: 'READY' })
  const plane = getAxiomControlPlane(f.runtime)
  const schedule = vi
    .spyOn(plane.scheduler, 'scheduleRound')
    .mockResolvedValue({ admitted: [], skipped: [] })
  const recompute = plane.missions.recomputeReadiness.bind(plane.missions)
  vi.spyOn(plane.missions, 'recomputeReadiness').mockImplementation((...args) => {
    recompute(...args)
    throw new Error('Rollback after recompute')
  })
  const before = f.snapshot()
  expect(await f.answer(id, 'Yes', 'rolled-back')).toMatchObject({ ok: false })
  expect(f.snapshot()).toEqual(before)
  expect(pending()).toHaveLength(1)
  expect(schedule).not.toHaveBeenCalled()
})
