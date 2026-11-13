import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pendingFixture, recordedAt, type PendingFixture } from './pending-fixture.test-support'
import { item, verification } from './pending-evidence.test-support'

let f: PendingFixture
beforeEach(() => {
  f = pendingFixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

it('uses the Planner launch failure evidence before offering another plan call', async () => {
  f.status('ANALYZING')
  const planner = f.db.createTask({ spec: 'Planner', taskTitle: 'Planner', runId: f.mission.runId })
  f.store.insertAttemptBinding({
    taskId: planner.id,
    missionId: f.missionId,
    seq: 1,
    branch: `axiom/planner/${f.missionId}/1`,
    dispatchId: null,
    agentSpecId: 'planner-spec',
    contextPackageId: 'planner-context'
  })
  expect((await f.pending()).items).toEqual([])
  f.audit(
    'attempt',
    `${planner.id}/1`,
    'planner.launch_failed',
    { reason: 'environment' },
    '2026-11-02T12:00:00.000Z'
  )
  expect(item((await f.pending()).items, 'mission').actions).toEqual([
    'axiom.mission.plan',
    'axiom.mission.cancel'
  ])
  expect(item((await f.pending()).items, 'mission').since).toBe('2026-11-02T12:00:00.000Z')
  f.store.updatePlanRevisionStatus({ id: f.planId, from: 'APPROVED', to: 'PROPOSED' })
  expect((await f.pending()).items.map((entry) => entry.kind)).toEqual(['plan_review'])
})

it('counts a Planner question against the Mission without a product Task id', async () => {
  f.status('ANALYZING')
  const planner = f.db.createTask({ spec: 'Planner', taskTitle: 'Planner', runId: f.mission.runId })
  const { dispatch } = f.db.createStartingWorkerDispatch({
    taskId: planner.id,
    creator: { kind: 'system' },
    maxDepth: 1,
    startOptions: { topology: 'current', agent: 'codex' }
  })
  f.store.insertAttemptBinding({
    taskId: planner.id,
    missionId: f.missionId,
    seq: 1,
    branch: `axiom/planner/${f.missionId}/1`,
    dispatchId: dispatch.id,
    agentSpecId: 'planner-spec',
    contextPackageId: 'planner-context'
  })
  const question = f.db.createQuestion({
    runId: f.mission.runId,
    dispatchId: dispatch.id,
    askerHandle: 'planner',
    question: 'Which acceptance boundary applies?'
  })
  const response = await f.pending()
  expect(response.items).toHaveLength(1)
  const pending = item(response.items, 'question', question.message.id)
  expect(pending).toMatchObject({
    summary: 'Which acceptance boundary applies?',
    reason: 'question',
    blocking: true,
    blocks: 12,
    actions: ['axiom.message.answer']
  })
  expect(pending).not.toHaveProperty('taskId')
  expect(pending).not.toHaveProperty('waitingOn')
})

it('projects a Mission budget from the current ledger or its persisted block audit', async () => {
  f.stage('T01', 'READY', 'fixture', 2)
  f.policy({ budget: { maxAttempts: 2 } })
  const expectedBudget = {
    on: 'budget',
    reason: 'budget_exhausted',
    person: true,
    budget: { scope: 'mission', dimension: 'maxAttempts', limit: 2, used: 2 }
  }
  expect(item((await f.pending()).items, 'mission')).toMatchObject({
    reason: 'budget_exhausted',
    blocks: 12,
    actions: ['axiom.mission.cancel'],
    waitingOn: expectedBudget
  })
  f.status('BLOCKED', 'budget_exhausted')
  f.audit(
    'mission',
    f.missionId,
    'budget.exhausted',
    { dimension: 'maxAttempts', limit: 2, used: 2 },
    '2026-11-01 12:00:00'
  )
  expect(item((await f.pending()).items, 'mission')).toMatchObject({
    reason: 'BLOCKED',
    summary: 'budget_exhausted',
    since: recordedAt,
    actions: ['axiom.mission.cancel'],
    waitingOn: expectedBudget
  })
  f.status('ANALYZING')
  expect(item((await f.pending()).items, 'mission')).toMatchObject({
    reason: 'budget_exhausted',
    actions: ['axiom.mission.cancel'],
    waitingOn: expectedBudget
  })
  await f.close()
  f = pendingFixture(false)
  f.status('ANALYZING')
  f.policy({ budget: { maxWallClockMinutes: 1 } })
  expect(item((await f.pending()).items, 'mission')).toMatchObject({
    reason: 'ANALYZING',
    actions: ['axiom.mission.plan', 'axiom.mission.cancel']
  })
})

it('filters review and blocked actions by the latest Candidate run and the stated reason', async () => {
  const original = verification(f, 'T01', 'HUMAN_REVIEW')
  for (const status of ['SPECIALIST_REVIEW', 'INCONCLUSIVE'] as const) {
    const latest = f.store.insertVerificationRun({
      ...original,
      id: `${original.id}-${status}`,
      status
    })
    expect(item((await f.pending()).items, 'human_review', latest.id).actions).toEqual([
      'axiom.task.cancel'
    ])
  }
  f.stage('T01', 'BLOCKED', 'scope')
  expect(item((await f.pending()).items, 'task_blocked', f.task('T01').taskId).actions).toEqual([
    'axiom.task.adjust',
    'axiom.verification.rerun',
    'axiom.task.cancel'
  ])
  f.store.insertVerificationRun({ ...original, id: `${original.id}-active`, status: 'RUNNING' })
  expect(item((await f.pending()).items, 'task_blocked', f.task('T01').taskId).actions).toEqual([
    'axiom.task.adjust',
    'axiom.task.cancel'
  ])
  f.stage('T01', 'CANCELED')
  f.message('T01')
  f.audit('task', f.task('T03').taskId, 'task.admission_refused', { installed: [], filtered: [] })
  const response = await f.pending()
  expect(item(response.items, 'task_blocked', f.task('T04').taskId).actions).toEqual([
    'axiom.task.cancel'
  ])
  expect(item(response.items, 'task_blocked', f.task('T03').taskId).actions).toEqual([
    'axiom.policy.update',
    'axiom.task.cancel'
  ])
  expect(
    response.items.some(
      (entry) => entry.kind === 'question' && entry.taskId === f.task('T01').taskId
    )
  ).toBe(false)
})

it('orders equally blocking items by the recorded time and then their stable id', async () => {
  f.stage('T01', 'BLOCKED', 'scope')
  f.stage('T02', 'BLOCKED', 'scope')
  const first = (await f.pending()).items
  expect(first.map((entry) => entry.blocks)).toEqual([10, 10])
  expect(first.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id).sort())
  f.audit(
    'task',
    f.task('T02').taskId,
    'task.stage',
    { stage: 'BLOCKED', reason: 'scope' },
    '2026-10-31 12:00:00'
  )
  expect((await f.pending()).items.map((entry) => entry.objectId)).toEqual([
    f.task('T02').taskId,
    f.task('T01').taskId
  ])
  expect(item((await f.pending()).items, 'task_blocked', f.task('T02').taskId).since).toBe(
    '2026-10-31T12:00:00.000Z'
  )
})
