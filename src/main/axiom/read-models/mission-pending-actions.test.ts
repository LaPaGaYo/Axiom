import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveAxiomCallerClass } from '../authority/caller-authority'
import { getAxiomControlPlane } from '../control-plane'
import { pendingFixture, type PendingFixture } from './pending-fixture.test-support'
import {
  act,
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

it('lists each pending item with the calls offered for it and drops it once settled', async () => {
  f.stage('T01', 'RUNNING')
  const question = f.message('T01')
  const run = verification(f, 'T02', 'HUMAN_REVIEW')
  tokenBudget(f, 'T03')
  f.stage('T03', 'BLOCKED', 'token_budget_exhausted')
  const notice = stall(f, 'T05')
  const open = proposal(f)
  const request = f.message('T06', {
    type: 'REQUEST_SUBTASK',
    question: undefined,
    summary: 'Validate storage',
    subtask: {
      title: 'Storage validation',
      objective: 'Validate storage',
      allowedPaths: ['src/storage/'],
      acceptanceCriteria: [{ text: 'Checks pass', check: { kind: 'human' } }],
      risk: 'low'
    }
  })
  const follow = f.message('T06', {
    type: 'REQUEST',
    question: undefined,
    summary: 'Consider extra coverage',
    followUp: { text: 'Consider extra coverage' }
  })
  const response = await f.pending()
  const q = item(response.items, 'question', question.id)
  const human = item(response.items, 'human_review', run.id)
  const token = item(response.items, 'task_blocked', f.task('T03').taskId)
  expect(q.actions).toEqual(['axiom.message.answer'])
  expect(human.actions).toEqual([
    'axiom.verification.resolve',
    'axiom.verification.rerun',
    'axiom.task.adjust',
    'axiom.task.cancel'
  ])
  expect(token.actions).toEqual(['axiom.task.adjust', 'axiom.task.cancel'])
  expect(item(response.items, 'subtask_request', request.id).actions).toEqual([
    'axiom.message.resolve'
  ])
  expect(item(response.items, 'follow_up', follow.id).actions).toEqual(['axiom.message.resolve'])
  expect(item(response.items, 'stall_notice', notice.attemptId).actions).toEqual([
    'axiom.task.cancel'
  ])
  expect(item(response.items, 'supervision_proposal', open.id).actions).toEqual([
    'axiom.supervision.resolve'
  ])
  for (const entry of response.items) {
    for (const action of entry.actions) {
      expect(resolveAxiomCallerClass(action, {})).toBe('desktop_only')
    }
  }
  f.status('PAUSED')
  const paused = await f.pending()
  expect(item(paused.items, 'mission').actions).toEqual([
    'axiom.mission.resume',
    'axiom.mission.cancel'
  ])
  for (const entry of paused.items.filter((entry) => entry.taskId)) {
    expect(entry.actions).not.toContain('axiom.task.adjust')
  }
  f.status('EXECUTING')
  f.policy({ concurrencyLimit: 1 })
  await act(f, q, 'axiom.message.answer', {
    missionId: f.missionId,
    questionId: q.objectId,
    body: 'Proceed'
  })
  expect((await f.pending()).items.some((entry) => entry.id === q.id)).toBe(false)
  await act(f, human, 'axiom.verification.resolve', {
    runId: human.objectId,
    verdict: 'PASS',
    rationale: 'Acceptance confirmed'
  })
  expect((await f.pending()).items.some((entry) => entry.id === human.id)).toBe(false)
  expect((await f.show('T02')).waitingOn.on).toBe('integration')
  await act(f, token, 'axiom.task.adjust', {
    taskId: token.objectId,
    maxTokens: 200,
    rationale: 'Raise the bounded token limit'
  })
  await getAxiomControlPlane(f.runtime).scheduler.scheduleRound(f.missionId, 'manual')
  expect((await f.pending()).items.some((entry) => entry.id === token.id)).toBe(false)
  expect((await f.show('T03')).waitingOn).toEqual({
    on: 'admission',
    reason: 'concurrency',
    person: false
  })
  for (const message of [request, follow]) {
    const entry = item(
      (await f.pending()).items,
      message.id === request.id ? 'subtask_request' : 'follow_up',
      message.id
    )
    await act(f, entry, 'axiom.message.resolve', {
      missionId: f.missionId,
      messageId: entry.objectId,
      decision: 'reject',
      rationale: 'Recorded for later work'
    })
    expect((await f.pending()).items.some((current) => current.id === entry.id)).toBe(false)
  }
})

it('offers the Mission and plan calls accepted by their current status', async () => {
  for (const [status, actions] of [
    ['PLANNED', ['axiom.mission.start', 'axiom.mission.cancel']],
    ['PAUSED', ['axiom.mission.resume', 'axiom.mission.cancel']],
    ['BLOCKED', ['axiom.mission.cancel']],
    ['ANALYZING', ['axiom.mission.plan', 'axiom.mission.cancel']]
  ] as const) {
    f.status(status, 'Awaiting a person')
    const entry = item((await f.pending()).items, 'mission')
    expect(entry).toMatchObject({
      objectId: f.missionId,
      blocking: true,
      blocks: 12,
      reason: status,
      actions: [...actions]
    })
    if (status === 'PAUSED' || status === 'BLOCKED') {
      expect(entry.summary).toBe('Awaiting a person')
    }
    for (const action of entry.actions) {
      expect(resolveAxiomCallerClass(action, {})).toBe('desktop_only')
    }
  }
  f.store.updatePlanRevisionStatus({ id: f.planId, from: 'APPROVED', to: 'PROPOSED' })
  f.status('PLAN_REVIEW')
  const review = item((await f.pending()).items, 'plan_review')
  expect(review).toMatchObject({
    objectId: f.planId,
    reason: 'PLAN_REVIEW',
    blocks: 12,
    actions: ['axiom.plan.approve', 'axiom.plan.reject']
  })
  for (const action of review.actions) {
    expect(resolveAxiomCallerClass(action, {})).toBe('desktop_only')
  }
  for (const status of ['COMPLETED', 'FAILED', 'CANCELED'] as const) {
    f.status(status)
    expect((await f.pending()).items).toEqual([])
  }
})

it('withholds plan review calls while the Mission is paused or blocked', async () => {
  f.store.updatePlanRevisionStatus({ id: f.planId, from: 'APPROVED', to: 'PROPOSED' })
  f.status('PLAN_REVIEW')
  expect(item((await f.pending()).items, 'plan_review').actions).toEqual([
    'axiom.plan.approve',
    'axiom.plan.reject'
  ])
  for (const status of ['PAUSED', 'BLOCKED'] as const) {
    f.status(status)
    expect(item((await f.pending()).items, 'plan_review')).toMatchObject({
      objectId: f.planId,
      blocking: true,
      actions: []
    })
    for (const method of ['axiom.plan.approve', 'axiom.plan.reject']) {
      expect(
        await f.call(method, { planRevisionId: f.planId, resolver: 'user', reason: 'Deferred' })
      ).toMatchObject({
        ok: false,
        error: { code: 'illegal_transition' }
      })
    }
    expect(f.store.getPlanRevision(f.planId)?.status).toBe('PROPOSED')
  }
  f.status('PLAN_REVIEW')
  expect(item((await f.pending()).items, 'plan_review').actions).toEqual([
    'axiom.plan.approve',
    'axiom.plan.reject'
  ])
})
