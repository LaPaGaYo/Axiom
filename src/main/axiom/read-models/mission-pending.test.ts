import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pendingFixture, recordedAt, type PendingFixture } from './pending-fixture.test-support'
import {
  databaseSnapshot,
  item,
  proposal,
  stall,
  tokenBudget,
  verification
} from './pending-evidence.test-support'

let f: PendingFixture
beforeEach(() => {
  f = pendingFixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

it('lists what needs a person in the order of what it unblocks', async () => {
  f.stage('T01', 'RUNNING')
  const question = f.message('T01')
  tokenBudget(f, 'T02')
  f.stage('T02', 'BLOCKED', 'token_budget_exhausted')
  const run = verification(f, 'T03', 'HUMAN_REVIEW')
  f.stage('T05', 'BLOCKED', 'scope')
  const blocked = f.message('T05', {
    type: 'BLOCKED',
    question: undefined,
    summary: 'Storage path is outside the allowed scope',
    blocked: { reason: 'blocked_by_scope', paths: ['src/storage/'] }
  })
  f.stage('T06', 'SUBMITTED')
  const reportQuestion = f.message('T06')
  f.stage('T07', 'VERIFIED')
  f.stage('T12', 'RUNNING')
  const views = await f.list()
  const response = await f.pending()
  expect(new Set(views.map((view) => view.waitingOn.on)).size).toBeGreaterThanOrEqual(5)
  expect(response.items.map(({ kind, objectId, blocks }) => ({ kind, objectId, blocks }))).toEqual([
    { kind: 'question', objectId: question.id, blocks: 10 },
    { kind: 'task_blocked', objectId: f.task('T02').taskId, blocks: 10 },
    { kind: 'task_blocked', objectId: f.task('T05').taskId, blocks: 7 },
    { kind: 'human_review', objectId: run.id, blocks: 5 },
    { kind: 'question', objectId: reportQuestion.id, blocks: 0 }
  ])
  expect(item(response.items, 'task_blocked', f.task('T05').taskId).summary).toBe(blocked.subject)
  expect(item(response.items, 'question', reportQuestion.id).blocking).toBe(false)
  for (const view of views.filter(
    (entry) => entry.waitingOn.person && entry.waitingOn.on !== 'approval'
  )) {
    expect(
      response.items.some(
        (entry) =>
          entry.blocking &&
          (entry.kind === 'mission' || entry.kind === 'plan_review' || entry.taskId === view.id)
      )
    ).toBe(true)
  }
  for (const entry of response.items) {
    expect(entry.id).toBe(`${entry.kind}:${entry.objectId}`)
    if (entry.taskId) {
      expect(entry.waitingOn).toEqual(views.find((view) => view.id === entry.taskId)?.waitingOn)
    }
  }
  expect((await f.pending()).items).toEqual(response.items)
})

it('lists stall notices and open supervision proposals as non-blocking items', async () => {
  const attempt = stall(f, 'T01')
  const open = proposal(f)
  const response = await f.pending()
  expect(response.items).toEqual([
    {
      id: `stall_notice:${attempt.attemptId}`,
      kind: 'stall_notice',
      objectId: attempt.attemptId,
      taskId: attempt.taskId,
      reason: 'stalled',
      blocking: false,
      blocks: 0,
      actions: ['axiom.task.cancel'],
      since: recordedAt,
      waitingOn: { on: 'running', reason: 'attempt_running', person: false, seq: attempt.seq }
    },
    {
      id: `supervision_proposal:${open.id}`,
      kind: 'supervision_proposal',
      objectId: open.id,
      reason: 'stalled',
      blocking: false,
      blocks: 0,
      actions: ['axiom.supervision.resolve'],
      since: new Date(`${open.createdAt.replace(' ', 'T')}Z`).toISOString()
    }
  ])
  f.store.insertAttemptBinding({
    taskId: attempt.taskId,
    missionId: f.missionId,
    seq: 2,
    dispatchId: null,
    branch: `axiom/attempt/${attempt.taskId}/2`,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  expect((await f.pending()).items.map((entry) => entry.kind)).toEqual(['supervision_proposal'])
  expect(
    await f.call('axiom.supervision.resolve', { proposalId: open.id, resolution: 'dismiss' })
  ).toMatchObject({ ok: true })
  expect((await f.pending()).items).toEqual([])
  f.status('COMPLETED')
  expect((await f.pending()).items).toEqual([])
})

it('refuses the pending view for an unknown Mission', async () => {
  expect(await f.call('axiom.mission.pending', { missionId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'mission_not_found' }
  })
  expect(
    await f.call('axiom.mission.pending', { missionId: f.missionId, unexpected: true })
  ).toMatchObject({ ok: false })
  expect(
    await f.call(
      'axiom.mission.pending',
      { missionId: f.missionId },
      { orchestrationContractVersion: undefined, orchestrationRequestId: undefined }
    )
  ).toMatchObject({ ok: true })
})

it('writes nothing while answering the Task list or the pending view', async () => {
  f.message('T01')
  verification(f, 'T02', 'HUMAN_REVIEW')
  tokenBudget(f, 'T03')
  f.stage('T03', 'BLOCKED', 'token_budget_exhausted')
  stall(f, 'T05')
  proposal(f)
  const before = databaseSnapshot(f)
  expect(before.length).toBeGreaterThan(20)
  expect(before.map((table) => table.name)).toEqual(
    expect.arrayContaining([
      'task_stages',
      'messages',
      'audit_events',
      'mutation_receipts',
      'axiom_effects',
      'verification_runs',
      'attempt_token_usage',
      'supervision_proposals'
    ])
  )
  for (let repeat = 0; repeat < 2; repeat++) {
    const tasks = await f.list()
    for (const task of tasks) {
      await f.show(task.id)
    }
    await f.pending()
  }
  expect(databaseSnapshot(f)).toEqual(before)
})

it('does not invent a pending item for a bare kernel gate', async () => {
  f.db.createGate({ taskId: f.task('T01').taskId, question: 'Kernel gate without a message' })
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'question',
    reason: 'question',
    person: true
  })
  expect((await f.pending()).items).toEqual([])
})

it('keeps one latest stall notice per current Attempt', async () => {
  const attempt = stall(f, 'T01')
  f.audit(
    'attempt',
    attempt.attemptId,
    'attempt.supervised',
    {
      taskId: attempt.taskId,
      seq: attempt.seq,
      rule: 'stalled',
      mode: 'notify',
      thresholdMs: 60_000,
      thresholdSource: 'default',
      idleMs: 240_000,
      lastEventAt: '2026-11-02T11:56:00.000Z',
      wouldActAt: '2026-11-02T11:57:00.000Z'
    },
    '2026-11-02T12:00:00.000Z'
  )
  const notices = (await f.pending()).items.filter((entry) => entry.kind === 'stall_notice')
  expect(notices).toHaveLength(1)
  expect(notices[0]).toMatchObject({
    id: `stall_notice:${attempt.attemptId}`,
    objectId: attempt.attemptId,
    since: '2026-11-02T12:00:00.000Z',
    taskId: attempt.taskId,
    blocking: false,
    blocks: 0
  })
})
