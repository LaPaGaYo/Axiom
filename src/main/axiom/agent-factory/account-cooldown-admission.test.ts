import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoutingPolicySchema } from '../../../shared/axiom-contract/mission-objects'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { ArtifactStore } from '../artifacts/artifact-store'
import { EffectOutbox } from '../outbox/effect-outbox'
import { Scheduler } from '../scheduler/scheduler'
import { RulesEngine } from '../decision-engine/rules-engine'
import { AgentFactory, buildWorkerContracts } from './agent-factory'
import { PROVIDER_SELECTION_RULES } from './provider-selection'
import { accountKey, readAccountCooldown } from './account-cooldown'

let f: ReturnType<typeof planned>
let root: string
let context: ContextBuilder
let effects: EffectOutbox
let waitingId: string
let readyId: string
let now: number
const until = '2026-11-10T12:01:00.000Z'
const homes = { codex: () => '/accounts/codex', claude: async () => '/accounts/claude' }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime('2026-11-10T12:00:00.000Z')
  now = Date.now()
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  root = mkdtempSync(path.join(tmpdir(), 'axiom-cooldown-admission-'))
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  const policy = f.store.getPolicy(f.missionId)
  if (!policy) {
    throw new Error('Missing policy')
  }
  f.store.upsertPolicy(f.missionId, {
    ...policy,
    routing: RoutingPolicySchema.parse({ roles: { worker: { provider: 'codex' } } })
  })
  const tasks = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })
  waitingId = tasks[0].taskId
  readyId = tasks[1].taskId
  context = new ContextBuilder(f.store, new ArtifactStore(f.store, root))
  effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'test' })
})
afterEach(async () => {
  await effects.stop()
  f.db.close()
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function enqueue() {
  f.store.insertAttemptBinding({
    missionId: f.missionId,
    taskId: waitingId,
    seq: 1,
    branch: 'waiting/1',
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  return f.store.transaction('test_cooldown', () =>
    f.store.enqueueEffect({
      kind: 'attempt.continue',
      missionId: f.missionId,
      key: `${waitingId}/1`,
      dueAt: until,
      payload: {
        taskId: waitingId,
        seq: 1,
        chain: 1,
        failureClass: 'usage_limit',
        account: { provider: 'codex', key: accountKey('codex', '/accounts/codex') }
      }
    })
  )
}
function factory(installed: string[], view = () => readAccountCooldown(f.store, homes, () => now)) {
  return new AgentFactory(
    f.store,
    new RulesEngine(PROVIDER_SELECTION_RULES),
    async () => installed,
    () => true,
    view
  )
}
it.each([false, true])(
  'records real Scheduler cooldown evidence (alternative=%s)',
  async (alternative) => {
    const effect = enqueue()
    const scheduler = new Scheduler(
      f.db,
      f.store,
      f.controller,
      context,
      factory(alternative ? ['codex', 'claude'] : ['codex']),
      { effects }
    )
    const result = await scheduler.scheduleRound(f.missionId, 'stage_change')
    const audits = f.store.listAuditEvents({ missionId: f.missionId })
    const refusal = audits.find(
      (event) => event.event === 'task.admission_refused' && event.objectId === readyId
    )
    const spec = f.store
      .listAgentSpecs(f.missionId)
      .find((record) => record.spec.role === 'worker' && record.spec.taskId === readyId)?.spec
    if (alternative) {
      expect(spec?.provider).toBe('claude')
      expect(spec?.selection.filtered.at(-1)).toEqual({
        provider: 'codex',
        reason: 'account_cooldown'
      })
      expect(spec?.selection.roleProviderUnavailable).toBe('account_cooldown')
      expect(refusal).toBeUndefined()
      expect(audits.find((event) => event.event === 'agent_spec.created')?.after).toEqual(
        spec?.selection
      )
    } else {
      expect(refusal?.after).toMatchObject({
        accountCooldown: [{ provider: 'codex', until }],
        filtered: expect.arrayContaining([{ provider: 'codex', reason: 'account_cooldown' }])
      })
      expect(f.store.getTaskStage(readyId)?.stage).toBe('READY')
      expect(f.store.nextAttemptSeq(readyId)).toBe(1)
      expect(result.skipped).toContainEqual({ taskId: readyId, reason: 'no_eligible_provider' })
    }
    console.info(
      'M3-06-2a-2 evidence:',
      JSON.stringify({
        alternative,
        selection: spec?.selection ?? null,
        admissionRefused: refusal?.after ?? null,
        effect
      })
    )
  }
)
it.each(['begins', 'ends'])(
  'keeps one cooldown view for both selections of an admission',
  async (change) => {
    if (change === 'ends') {
      enqueue()
    }
    const view = vi.fn(() => {
      expect(f.db.db.isTransaction).toBe(false)
      return readAccountCooldown(f.store, homes, () => now)
    })
    const builder = context.build.bind(context)
    vi.spyOn(context, 'build').mockImplementation(async (input) => {
      const result = await builder(input)
      if (change === 'begins') {
        enqueue()
      } else {
        now = Date.parse(until)
      }
      return result
    })
    const result = await buildWorkerContracts(
      context,
      factory(['codex', 'claude'], view),
      f.missionId,
      readyId
    )
    expect(view).toHaveBeenCalledOnce()
    expect(f.store.getAgentSpec(result.agentSpecId)?.spec.provider).toBe(
      change === 'begins' ? 'codex' : 'claude'
    )
  }
)
it('never obtains a cooldown view for a Planner build', async () => {
  const view = vi.fn(async () => new Map<string, string>())
  const goalRevisionId = f.store.getMission(f.missionId)?.activeGoalRevisionId
  if (!goalRevisionId) {
    throw new Error('Missing Goal')
  }
  await factory(['codex'], view).build({ missionId: f.missionId, goalRevisionId, role: 'planner' })
  expect(view).not.toHaveBeenCalled()
})
