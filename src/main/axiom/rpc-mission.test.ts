import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import { GoalRevisionSchema, PlanRevisionSchema } from '../../shared/axiom-contract/mission-objects'
import { MissionSummarySchema } from '../../shared/axiom-contract/mission-params'
import { TaskListItemSchema } from '../../shared/axiom-contract/task-params'
import {
  makeProposal,
  provenance
} from '../../shared/axiom-contract/contract-fixtures.test-support'
import { createParams, rpcFixture } from './rpc-fixture.test-support'

const Created = z.object({ mission: MissionSummarySchema, goalRevision: GoalRevisionSchema })
const Planned = z.object({ planRevision: PlanRevisionSchema })

describe('Axiom Mission RPC through the dispatcher', () => {
  const fixtures: ReturnType<typeof rpcFixture>[] = []
  function harness() {
    const f = rpcFixture()
    fixtures.push(f)
    return f
  }
  afterEach(() => {
    for (const f of fixtures.splice(0)) {
      f.db.close()
    }
  })

  it('fences mission.create without a contract before any Mission or receipt exists', async () => {
    const f = harness()
    expect(
      await f.call('axiom.mission.create', createParams, {
        orchestrationContractVersion: undefined,
        orchestrationRequestId: 'fenced'
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'orchestration_migration_required',
        data: { reason: 'client_contract_missing' }
      }
    })
    expect(f.store.listMissions({})).toEqual([])
    expect(
      f.db.getMutationReceipt(f.db.getOrCreateLocalMutationCallerFingerprint(), 'fenced')
    ).toBeUndefined()
  })

  it('replays one durable receipt and rejects reuse with different input', async () => {
    const f = harness()
    const envelope = { orchestrationRequestId: 'create-once' }
    const first = await f.call('axiom.mission.create', createParams, envelope)
    const replay = await f.call('axiom.mission.create', createParams, envelope)
    expect(first.ok).toBe(true)
    expect(replay.ok).toBe(true)
    if (!first.ok || !replay.ok) {
      throw new Error('Expected successful creation')
    }
    expect(Created.parse(replay.result)).toEqual(Created.parse(first.result))
    expect(replay.result).toMatchObject({ mutation: { replayed: true } })
    expect(f.store.listMissions({})).toHaveLength(1)
    expect(
      await f.call('axiom.mission.create', { ...createParams, targetBranch: 'other' }, envelope)
    ).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
    expect(f.store.listMissions({})).toHaveLength(1)
  })

  it('creates, proposes, approves and starts the frozen 12-task graph with 3 READY', async () => {
    const f = harness()
    const response = await f.call('axiom.mission.create', createParams)
    expect(response.ok).toBe(true)
    if (!response.ok) {
      throw new Error(response.error.code)
    }
    const { mission, goalRevision } = Created.parse(response.result)
    const proposal = await f.call('axiom.plan.propose', {
      missionId: mission.id,
      planRevision: { ...makeProposal(), goalRevisionId: goalRevision.id },
      provenance
    })
    expect(proposal.ok).toBe(true)
    if (!proposal.ok) {
      throw new Error(proposal.error.code)
    }
    const { planRevision } = Planned.parse(proposal.result)
    expect(
      await f.call('axiom.plan.approve', { planRevisionId: planRevision.id, resolver: 'henry' })
    ).toMatchObject({ ok: true, result: { planRevision: { status: 'APPROVED' } } })
    expect(await f.call('axiom.mission.start', { missionId: mission.id })).toMatchObject({
      ok: true,
      result: { mission: { status: 'EXECUTING' } }
    })
    const tasks = await f.call(
      'axiom.task.list',
      { missionId: mission.id },
      {
        orchestrationContractVersion: undefined,
        orchestrationRequestId: undefined
      }
    )
    expect(tasks.ok).toBe(true)
    if (!tasks.ok) {
      throw new Error(tasks.error.code)
    }
    const result = z.object({ tasks: z.array(TaskListItemSchema) }).parse(tasks.result)
    expect(result.tasks).toHaveLength(12)
    expect(result.tasks.filter((t) => t.stage === 'READY')).toHaveLength(3)
    expect(result.tasks.filter((t) => t.stage === 'RUNNING')).toEqual([])
    expect(f.store.listAttemptBindings({ missionId: mission.id })).toEqual([])
    expect(result.tasks.every((t) => t.orcaStatus === 'ready')).toBe(true)
  })

  it('preserves controller error codes and data', async () => {
    const f = harness()
    expect(await f.call('axiom.mission.show', { missionId: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'mission_not_found', data: { missionId: 'missing' } }
    })
    const created = await f.call('axiom.mission.create', createParams)
    if (!created.ok) {
      throw new Error(created.error.code)
    }
    const { mission, goalRevision } = Created.parse(created.result)
    expect(await f.call('axiom.mission.start', { missionId: mission.id })).toMatchObject({
      ok: false,
      error: { code: 'illegal_transition', data: { from: 'ANALYZING' } }
    })
    const input = {
      missionId: mission.id,
      planRevision: { ...makeProposal(), goalRevisionId: goalRevision.id },
      provenance
    }
    expect((await f.call('axiom.plan.propose', input)).ok).toBe(true)
    expect(await f.call('axiom.plan.propose', input)).toMatchObject({
      ok: false,
      error: { code: 'plan_pending', data: { missionId: mission.id } }
    })
  })
})
