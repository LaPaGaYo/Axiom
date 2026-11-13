import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pendingFixture, type PendingFixture } from './pending-fixture.test-support'
import { binding, tokenBudget, verification } from './pending-evidence.test-support'
import { MISSION_STATUSES, TASK_STAGES } from '../../../shared/axiom-contract/lifecycle'

let f: PendingFixture
beforeEach(() => {
  f = pendingFixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

it('says which upstream Tasks a defined Task waits on', async () => {
  expect((await f.show('T04')).waitingOn).toEqual({
    on: 'dependency',
    reason: 'upstream_not_integrated',
    person: false,
    taskIds: expect.arrayContaining([f.task('T01').taskId, f.task('T02').taskId])
  })
  f.stage('T01', 'INTEGRATED')
  expect((await f.show('T04')).waitingOn.taskIds).toEqual([f.task('T02').taskId])
  f.stage('T02', 'CANCELED')
  expect((await f.show('T04')).waitingOn).toEqual({
    on: 'dependency',
    reason: 'upstream_canceled',
    person: true,
    taskIds: [f.task('T02').taskId]
  })
})

it('says a Task waits on its Mission when the Mission is not executing', async () => {
  for (const status of MISSION_STATUSES.filter((value) => value !== 'EXECUTING')) {
    f.status(status)
    for (const stage of ['DEFINED', 'READY', 'NEEDS_FIX'] as const) {
      f.stage('T01', stage)
      expect((await f.show('T01')).waitingOn).toEqual({
        on: 'mission',
        reason: status,
        person: ['PLAN_REVIEW', 'PLANNED', 'PAUSED', 'BLOCKED'].includes(status),
        missionStatus: status
      })
    }
  }
  f.status('EXECUTING')
  f.store.updatePlanRevisionStatus({ id: f.planId, from: 'APPROVED', to: 'SUPERSEDED' })
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'mission',
    reason: 'plan_not_approved',
    person: false,
    missionStatus: 'EXECUTING'
  })
  f.stage('T01', 'RUNNING')
  f.status('PAUSED')
  expect((await f.show('T01')).waitingOn).toMatchObject({ on: 'running', person: false })
  f.stage('T01', 'SUBMITTED')
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'verification',
    reason: 'QUEUED',
    person: false
  })
})

it('says a submitted or verifying Task waits on verification and a verified Task on integration', async () => {
  f.stage('T01', 'SUBMITTED')
  f.message('T01')
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'verification',
    reason: 'QUEUED',
    person: false
  })
  f.stage('T01', 'VERIFYING')
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'verification',
    reason: 'QUEUED',
    person: false
  })
  const run = verification(f, 'T02', 'QUEUED')
  for (const status of ['QUEUED', 'RUNNING', 'PASS', 'FAIL', 'CANCELED'] as const) {
    const latest = f.store.insertVerificationRun({ ...run, id: `${run.id}-${status}`, status })
    expect((await f.show('T02')).waitingOn).toEqual({
      on: 'verification',
      reason: status,
      person: false,
      runId: latest.id
    })
  }
  for (const stage of ['VERIFIED', 'INTEGRATION_READY'] as const) {
    f.stage('T02', stage)
    expect((await f.show('T02')).waitingOn).toEqual({
      on: 'integration',
      reason: 'integration_queue',
      person: false
    })
  }
})

it('says a Task in human review or blocked for another reason waits on a person', async () => {
  const run = verification(f, 'T01', 'HUMAN_REVIEW')
  f.message('T01')
  for (const status of ['HUMAN_REVIEW', 'SPECIALIST_REVIEW', 'INCONCLUSIVE'] as const) {
    const latest = f.store.insertVerificationRun({ ...run, id: `${run.id}-${status}`, status })
    expect((await f.show('T01')).waitingOn).toEqual({
      on: 'human',
      reason: 'acceptance_human',
      person: true,
      runId: latest.id
    })
  }
  const fallback = f.store.insertVerificationRun({
    ...run,
    id: `${run.id}-fallback`,
    verdictDetail: { reason: 3 }
  })
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'human',
    reason: 'human_review',
    person: true,
    runId: fallback.id
  })
  for (const reason of ['scope', 'candidate_disputed', 'environment']) {
    f.stage('T02', 'BLOCKED', reason)
    expect((await f.show('T02')).waitingOn).toEqual({ on: 'human', reason, person: true })
  }
  f.audit('task', f.task('T02').taskId, 'task.stage', { stage: 'BLOCKED' })
  expect((await f.show('T02')).waitingOn).toEqual({ on: 'human', reason: 'blocked', person: true })
})

it('says a running Task is running and a finished Task waits on nothing', async () => {
  const attempt = binding(f, 'T01')
  f.stage('T01', 'RUNNING')
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'running',
    reason: 'attempt_running',
    person: false,
    seq: attempt.seq
  })
  f.store.insertAttemptBinding({
    taskId: attempt.taskId,
    missionId: f.missionId,
    seq: 2,
    branch: `axiom/attempt/${attempt.taskId}/2`,
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  expect((await f.show('T01')).waitingOn.seq).toBe(2)
  f.message('T01')
  for (const stage of ['INTEGRATED', 'CANCELED'] as const) {
    f.stage('T01', stage)
    expect((await f.show('T01')).waitingOn).toEqual({
      on: 'none',
      reason: stage.toLowerCase(),
      person: false
    })
  }
})

it('gives every Task exactly one waiting reason in first-match order', async () => {
  f.stage('T01', 'INTEGRATED')
  f.stage('T02', 'CANCELED')
  f.stage('T03', 'READY', 'fixture', 2)
  f.message('T03')
  f.stage('T04', 'DEFINED')
  f.message('T04')
  f.stage('T05', 'NEEDS_FIX')
  f.message('T05')
  f.stage('T06', 'RUNNING')
  f.message('T06')
  f.stage('T07', 'SUBMITTED')
  f.message('T07')
  const run = verification(f, 'T08', 'HUMAN_REVIEW')
  f.message('T08')
  f.stage('T09', 'VERIFIED')
  f.stage('T10', 'INTEGRATION_READY')
  tokenBudget(f, 'T11')
  f.stage('T11', 'BLOCKED', 'token_budget_exhausted')
  const attempt = binding(f, 'T12')
  f.stage('T12', 'RUNNING')
  const rows = await f.list()
  expect(new Set(rows.map((row) => row.stage))).toEqual(new Set(TASK_STAGES))
  const expected = [
    ['T01', 'none', 'integrated'],
    ['T02', 'none', 'canceled'],
    ['T03', 'question', 'question'],
    ['T04', 'dependency', 'upstream_canceled'],
    ['T05', 'dependency', 'upstream_not_integrated'],
    ['T06', 'question', 'question'],
    ['T07', 'verification', 'QUEUED'],
    ['T08', 'human', 'acceptance_human'],
    ['T09', 'integration', 'integration_queue'],
    ['T10', 'integration', 'integration_queue'],
    ['T11', 'budget', 'token_budget_exhausted'],
    ['T12', 'running', 'attempt_running']
  ]
  for (const [id, on, reason] of expected) {
    const view = rows.find((row) => row.id === f.task(id).taskId)
    expect(view?.waitingOn).toMatchObject({ on, reason })
    expect(Array.isArray(view?.waitingOn)).toBe(false)
  }
  expect(rows.find((row) => row.id === f.task('T08').taskId)?.waitingOn.runId).toBe(run.id)
  expect(rows.find((row) => row.id === f.task('T12').taskId)?.waitingOn.seq).toBe(attempt.seq)
})

it('shows the waiting reason in the Task list and the Task view', async () => {
  f.message('T01')
  f.stage('T02', 'VERIFIED')
  for (const row of await f.list()) {
    expect((await f.show(row.id)).waitingOn).toEqual(row.waitingOn)
  }
  const canceled = await f.call('axiom.task.cancel', {
    taskId: f.task('T03').taskId,
    rationale: 'No longer needed'
  })
  expect(canceled).toMatchObject({ ok: true, result: { task: { stage: 'CANCELED' } } })
  if (!canceled.ok) {
    throw new Error(canceled.error.code)
  }
  expect(canceled.result).not.toHaveProperty('task.waitingOn')
})
