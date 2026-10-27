import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoutingPolicySchema, type Policy } from '../../../shared/axiom-contract/mission-objects'
import * as generated from '../../runtime/orchestration/db/generated-id'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { AgentFactory } from '../agent-factory/agent-factory'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { RulesEngine } from '../decision-engine/rules-engine'
import { Scheduler, type AdmittedAttempt, type AttemptLaunch } from './scheduler'

let f: ReturnType<typeof planned>
let root: string
let context: ContextBuilder
let factory: AgentFactory
let installed: string[]
let launched: AdmittedAttempt[]
let launch: AttemptLaunch
let scheduler: Scheduler

beforeEach(async () => {
  let next = 0
  vi.spyOn(generated, 'generateId').mockImplementation(
    (prefix) => `${prefix}_${String(++next).padStart(12, '0')}`
  )
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  root = await mkdtemp(path.join(tmpdir(), 'axiom-scheduler-'))
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  context = new ContextBuilder(f.store, new ArtifactStore(f.store, root))
  installed = ['codex', 'claude']
  factory = new AgentFactory(
    f.store,
    new RulesEngine(PROVIDER_SELECTION_RULES),
    async () => installed
  )
  launched = []
  launch = async (attempt) => {
    expect(f.db.db.isTransaction).toBe(false)
    expect(f.store.getAttemptBinding(attempt.taskId, attempt.seq)).toMatchObject({
      ...attempt,
      dispatchId: null
    })
    expect(f.store.getTaskStage(attempt.taskId)?.stage).toBe('RUNNING')
    launched.push(attempt)
  }
  scheduler = makeScheduler()
})
afterEach(async () => {
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})

function makeScheduler(launcher: AttemptLaunch = launch, now?: () => string) {
  return new Scheduler(f.db, f.store, f.controller, context, factory, { launch: launcher, now })
}
function task(id: string) {
  const row = f.store.listTaskStages({ missionId: f.missionId }).find((t) => t.spec.id === id)
  if (!row) {
    throw new Error(`Missing ${id}`)
  }
  return row
}
function policy(patch: Partial<Policy>) {
  f.store.upsertPolicy(f.missionId, { ...f.store.getPolicy(f.missionId)!, ...patch })
}
function round(s = scheduler) {
  return s.scheduleRound(f.missionId, 'manual')
}
function events(name: string) {
  return f.store.listAuditEvents({ missionId: f.missionId }).filter((e) => e.event === name)
}
function gate(id = 'T01') {
  return f.db.createGate({ taskId: task(id).taskId, question: 'Clarify scope' })
}
function seedDefined(id: string) {
  f.store.updateTaskStage({ taskId: task(id).taskId, from: 'READY', to: 'DEFINED' })
}

describe('Scheduler admission', () => {
  it('orders the 12-Task fixture by longest downstream chain then id and launches after commit', async () => {
    const result = await round()
    expect(result.admitted.map((a) => f.store.getTaskStage(a.taskId)?.spec.id)).toEqual([
      'T01',
      'T02',
      'T03'
    ])
    expect(launched).toEqual(result.admitted)
    expect(result.admitted.map((a) => a.seq)).toEqual([1, 1, 1])
    expect(result.admitted.map((a) => a.branch)).toEqual(
      result.admitted.map((a) => `axiom/attempt/${a.taskId}/1`)
    )
    expect(events('scheduler.round')).toHaveLength(1)
    expect(events('scheduler.round')[0].after).toEqual({
      trigger: 'manual',
      admitted: result.admitted,
      skipped: []
    })
    expect(events('attempt.admitted')).toHaveLength(3)
    const audit = f.store.listAuditEvents({ missionId: f.missionId })
    expect(await round()).toEqual({ admitted: [], skipped: [] })
    expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(audit)
  })
  it('limits admission to one and reports concurrency for remaining READY Tasks on the next round', async () => {
    policy({ concurrencyLimit: 1 })
    expect((await round()).admitted).toHaveLength(1)
    expect(await round()).toEqual({
      admitted: [],
      skipped: [
        { taskId: task('T02').taskId, reason: 'concurrency' },
        { taskId: task('T03').taskId, reason: 'concurrency' }
      ]
    })
  })
  it('counts only latest bindings of RUNNING Tasks for provider concurrency', async () => {
    policy({ routing: RoutingPolicySchema.parse({ providerConcurrency: { claude: 1 } }) })
    const result = await round()
    expect(result.admitted).toHaveLength(1)
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'provider_concurrency',
      'provider_concurrency'
    ])
    expect(f.store.countRunningTasksForProvider(f.missionId, 'claude')).toBe(1)
    expect(f.store.countRunningTasksForProvider(f.missionId, 'codex')).toBe(0)
  })
  it('rejects stale admission when two instances build for the same READY Task', async () => {
    policy({ concurrencyLimit: 2 })
    gate('T02')
    gate('T03')
    const build = context.build.bind(context)
    const barrier = Promise.withResolvers<void>()
    let builders = 0
    vi.spyOn(context, 'build').mockImplementation(async (input) => {
      const result = await build(input)
      if (++builders === 2) {
        barrier.resolve()
      }
      await barrier.promise
      return result
    })
    const results = await Promise.all([round(), round(makeScheduler())])
    expect(results.flatMap((r) => r.admitted)).toHaveLength(1)
    expect(results.flatMap((r) => r.skipped)).toContainEqual({
      taskId: task('T01').taskId,
      reason: 'stale'
    })
    expect(f.store.listAttemptBindings({ missionId: f.missionId })).toHaveLength(1)
    expect(task('T01').attemptCount).toBe(1)
  })
  it('rechecks concurrency in the transaction: two rounds, limit 1, only one admitted', async () => {
    policy({ concurrencyLimit: 1 })
    const built = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const build = factory.build.bind(factory)
    vi.spyOn(factory, 'build').mockImplementationOnce(async (input) => {
      const result = await build(input)
      built.resolve()
      await release.promise
      return result
    })
    const first = round()
    await built.promise
    const blocker = gate('T01')
    const second = await round(makeScheduler())
    f.db.resolveGate(blocker.id, 'resolved')
    release.resolve()
    const result = await first
    expect([...result.admitted, ...second.admitted]).toHaveLength(1)
    expect(result.skipped).toContainEqual({ taskId: task('T01').taskId, reason: 'concurrency' })
    expect(f.store.countTaskStages(f.missionId).RUNNING).toBe(1)
  })
  it('blocks the Mission after its total Attempt budget is exhausted', async () => {
    policy({ budget: { maxAttempts: 2 } })
    const result = await round()
    expect(result.admitted).toHaveLength(2)
    expect(result.blocked).toBe('maxAttempts')
    expect(f.store.getMission(f.missionId)).toMatchObject({
      status: 'BLOCKED',
      previousStatus: 'EXECUTING'
    })
    expect(events('budget.exhausted')[0].after).toEqual({
      dimension: 'maxAttempts',
      limit: 2,
      used: 2
    })
    expect(events('scheduler.round')).toHaveLength(1)
  })
  it('measures Mission wall-clock from the first EXECUTING audit across pause/resume', async () => {
    policy({ budget: { maxWallClockMinutes: 1 } })
    f.controller.pauseMission(f.missionId)
    f.controller.resumeMission(f.missionId)
    expect((await round(makeScheduler(launch, () => '2026-10-17T12:02:00Z'))).blocked).toBe(
      'maxWallClockMinutes'
    )
    expect(events('budget.exhausted')[0].after).toEqual({
      dimension: 'maxWallClockMinutes',
      limit: 1,
      used: 2
    })
    expect(launched).toEqual([])
  })
  it('enforces Task Attempt limits without blocking the Mission', async () => {
    f.store.updateTaskStage({
      taskId: task('T01').taskId,
      from: 'READY',
      to: 'READY',
      attemptCountDelta: 2
    })
    const result = await round()
    expect(result.skipped).toContainEqual({ taskId: task('T01').taskId, reason: 'task_attempts' })
    expect(result.admitted).toHaveLength(2)
    expect(f.store.getMission(f.missionId)?.status).toBe('EXECUTING')
  })
  it('skips unavailable providers without a binding or Mission block', async () => {
    installed = []
    const result = await round()
    expect(result.skipped.map((s) => s.reason)).toEqual(Array(3).fill('no_eligible_provider'))
    expect(result.admitted).toEqual([])
    expect(f.store.listAttemptBindings({ missionId: f.missionId })).toEqual([])
    expect(f.store.getMission(f.missionId)?.status).toBe('EXECUTING')
    expect(events('scheduler.round')).toEqual([])
  })
  it('records no_account and keeps ready Tasks unadmitted when Codex has no owned home', async () => {
    factory = new AgentFactory(
      f.store,
      new RulesEngine(PROVIDER_SELECTION_RULES),
      async () => ['codex'],
      () => false
    )
    const result = await round(makeScheduler())
    expect(result.admitted).toEqual([])
    expect(launched).toEqual([])
    expect(f.store.listAttemptBindings({ missionId: f.missionId })).toEqual([])
    expect(task('T01').stage).toBe('READY')
    const refusals = events('task.admission_refused')
    expect(refusals).toHaveLength(3)
    for (const refusal of refusals) {
      expect(refusal.after).toMatchObject({
        filtered: expect.arrayContaining([{ provider: 'codex', reason: 'no_account' }])
      })
    }
  })
  it('resumes sequence allocation and RUNNING counts with a new Scheduler instance', async () => {
    policy({ concurrencyLimit: 2 })
    await round()
    f.controller.transitionTaskStage({
      taskId: task('T01').taskId,
      to: 'NEEDS_FIX',
      actor: 'test',
      reason: 'failed'
    })
    f.controller.transitionTaskStage({
      taskId: task('T01').taskId,
      to: 'READY',
      actor: 'test',
      reason: 'retry'
    })
    const result = await round(makeScheduler())
    expect(result.admitted).toHaveLength(1)
    expect(result.admitted[0]).toMatchObject({ taskId: task('T01').taskId, seq: 2 })
    expect(result.skipped).toContainEqual({ taskId: task('T03').taskId, reason: 'concurrency' })
    expect(task('T01').attemptCount).toBe(2)
    expect(
      f.store
        .listAttemptBindings({ missionId: f.missionId, taskId: task('T01').taskId })
        .map((b) => b.seq)
    ).toEqual([1, 2])
    expect(f.store.countRunningTasksForProvider(f.missionId, 'claude')).toBe(2)
  })
  it('settles rejected launches for retry, retaining evidence and continuing the round', async () => {
    const failing = vi.fn(launch).mockRejectedValueOnce(new Error('secret-token-must-not-leak'))
    const result = await round(makeScheduler(failing))
    expect(result.admitted).toHaveLength(3)
    expect(failing).toHaveBeenCalledTimes(3)
    expect(events('attempt.launch_failed')).toHaveLength(1)
    expect(events('attempt.launch_failed')[0]).toMatchObject({
      objectKind: 'attempt',
      objectId: `${task('T01').taskId}/1`
    })
    expect(JSON.stringify(events('attempt.launch_failed'))).not.toContain('secret-token')
    expect(f.store.countTaskStages(f.missionId)).toMatchObject({ RUNNING: 2, READY: 1 })
    expect(events('task.stage')).toContainEqual(
      expect.objectContaining({ after: expect.objectContaining({ reason: 'launch_rejected' }) })
    )
  })
  it('coalesces overlapping requests to one follow-up round without duplicate admission', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    scheduler = makeScheduler(async (attempt) => {
      await launch(attempt)
      entered.resolve()
      await release.promise
    })
    const readiness = vi.spyOn(f.controller, 'recomputeReadiness')
    const first = round()
    await entered.promise
    const requests = Array.from({ length: 20 }, () =>
      scheduler.scheduleRound(f.missionId, 'stage_change')
    )
    expect(readiness).toHaveBeenCalledTimes(1)
    release.resolve()
    await Promise.all([first, ...requests])
    expect(readiness).toHaveBeenCalledTimes(2)
    expect(launched).toHaveLength(3)
  })
  it('returns empty outside EXECUTING and revalidates state after async builds', async () => {
    f.controller.pauseMission(f.missionId)
    expect(await round()).toEqual({ admitted: [], skipped: [] })
    f.controller.resumeMission(f.missionId)
    const build = factory.build.bind(factory)
    vi.spyOn(factory, 'build').mockImplementationOnce(async (input) => {
      const result = await build(input)
      f.controller.pauseMission(f.missionId)
      return result
    })
    expect((await round()).admitted).toEqual([])
    expect(f.store.listAttemptBindings({ missionId: f.missionId })).toEqual([])
  })

  it('pauses new admission while an existing Attempt remains RUNNING, then resumes admission', async () => {
    policy({ concurrencyLimit: 1 })
    await round()
    const bindings = f.store.listAttemptBindings({ missionId: f.missionId })
    expect(bindings).toHaveLength(1)
    policy({ concurrencyLimit: 2 })
    f.controller.pauseMission(f.missionId)
    expect(await round()).toEqual({ admitted: [], skipped: [] })
    expect(task('T01').stage).toBe('RUNNING')
    expect(task('T02').stage).toBe('READY')
    expect(f.store.listAttemptBindings({ missionId: f.missionId })).toEqual(bindings)
    f.controller.resumeMission(f.missionId)
    expect((await round()).admitted).toMatchObject([{ taskId: task('T02').taskId, seq: 1 }])
    expect(task('T01').stage).toBe('RUNNING')
  })
  it('rolls back admission if its audit fails', async () => {
    const append = f.store.appendAuditEvent
    vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
      if (input.event === 'attempt.admitted') {
        throw new Error('audit failed')
      }
      return append(input)
    })
    await expect(round()).rejects.toThrow('audit failed')
    expect(f.store.listAttemptBindings({ missionId: f.missionId })).toEqual([])
    expect(task('T01')).toMatchObject({ stage: 'READY', attemptCount: 0 })
    expect(launched).toEqual([])
  })

  it.each(['question', 'approval', 'missing_context', 'changed_policy'] as const)(
    'revalidates %s introduced during async contract construction',
    async (change) => {
      const build = factory.build.bind(factory)
      vi.spyOn(factory, 'build').mockImplementationOnce(async (input) => {
        const result = await build(input)
        if (change === 'question') {
          gate('T01')
        } else if (change === 'approval') {
          f.db.db
            .prepare(`INSERT INTO approvals (id, mission_id, action_kind, inputs_hash, risk, status, expires_at, requested_by)
            VALUES ('approval', ?, 'budget_increase', 'hash', 'high', 'PENDING', '2099-01-01', 'test')`)
            .run(f.missionId)
        } else if (change === 'missing_context' && input.role === 'worker') {
          f.db.db.prepare('DELETE FROM context_packages WHERE id = ?').run(input.contextPackageId)
        } else {
          policy({ routing: RoutingPolicySchema.parse({ disallowedProviders: ['claude'] }) })
        }
        return result
      })
      const result = await round()
      expect(result.skipped).toContainEqual({
        taskId: task('T01').taskId,
        reason: change === 'question' || change === 'approval' ? change : 'stale'
      })
      expect(task('T01')).toMatchObject({ stage: 'READY', attemptCount: 0 })
      expect(
        f.store.listAttemptBindings({ missionId: f.missionId, taskId: task('T01').taskId })
      ).toEqual([])
    }
  )
})

describe('real admission blockers', () => {
  it.each(['gate', 'thread', 'approval'] as const)(
    'blocks READY admission and DEFINED readiness for a pending %s',
    async (kind) => {
      const taskId = task('T01').taskId
      let resolve: () => void
      if (kind === 'gate') {
        const blocker = gate()
        resolve = () => {
          f.db.resolveGate(blocker.id, 'resolved')
        }
      } else if (kind === 'thread') {
        f.store.insertAttemptBinding({
          missionId: f.missionId,
          taskId,
          seq: 1,
          branch: `axiom/attempt/${taskId}/1`,
          dispatchId: 'old-dispatch',
          agentSpecId: 'old-spec',
          contextPackageId: 'old-context'
        })
        f.db.db
          .prepare(
            'INSERT INTO question_threads (message_id, run_id, dispatch_id, asker_handle) VALUES (?, ?, ?, ?)'
          )
          .run('question', f.store.getMission(f.missionId)!.runId, 'old-dispatch', 'worker')
        resolve = () => {
          f.db.db
            .prepare(
              "UPDATE question_threads SET status = 'answered' WHERE message_id = 'question'"
            )
            .run()
        }
      } else {
        f.db.db
          .prepare(`INSERT INTO approvals (id, mission_id, action_kind, inputs_hash, risk, status, expires_at, requested_by)
        VALUES ('approval', ?, 'budget_increase', 'hash', 'high', 'PENDING', '2099-01-01', 'test')`)
          .run(f.missionId)
        resolve = () => {
          f.db.db.prepare("UPDATE approvals SET status = 'GRANTED' WHERE id = 'approval'").run()
        }
      }
      const reason = kind === 'approval' ? 'approval' : 'question'
      expect((await round()).skipped).toContainEqual({ taskId, reason })
      seedDefined('T01')
      expect(f.controller.recomputeReadiness(f.missionId)).toEqual([])
      expect(() =>
        f.controller.transitionTaskStage({ taskId, to: 'READY', reason: 'bypass', actor: 'test' })
      ).toThrowError(expect.objectContaining({ code: 'illegal_transition' }))
      resolve()
      expect(f.controller.recomputeReadiness(f.missionId)).toContain(taskId)
      expect((await round()).admitted.map((a) => a.taskId)).toContain(taskId)
    }
  )
  it('does not treat unrelated or non-PENDING approvals as blockers', async () => {
    f.db.db
      .prepare(`INSERT INTO approvals (id, mission_id, action_kind, inputs_hash, risk, status, expires_at, requested_by)
      VALUES ('approval', ?, 'delivery', 'hash', 'high', 'PENDING', '2099-01-01', 'test')`)
      .run(f.missionId)
    expect((await round()).admitted).toHaveLength(3)
  })
})
