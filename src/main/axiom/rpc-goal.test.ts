import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { GoalRevisionSchema } from '../../shared/axiom-contract/mission-objects'
import { MissionSummarySchema } from '../../shared/axiom-contract/mission-params'
import { goal } from '../../shared/axiom-contract/contract-fixtures.test-support'
import { createParams, rpcFixture } from './rpc-fixture.test-support'

describe('Goal RPC lifecycle', () => {
  const fixtures: ReturnType<typeof rpcFixture>[] = []
  afterEach(() => {
    for (const f of fixtures.splice(0)) {
      f.db.close()
    }
  })
  async function harness() {
    const f = rpcFixture()
    fixtures.push(f)
    const created = await f.call('axiom.mission.create', createParams)
    if (!created.ok) {
      throw new Error(created.error.code)
    }
    return {
      ...f,
      ...z
        .object({ mission: MissionSummarySchema, goalRevision: GoalRevisionSchema })
        .parse(created.result)
    }
  }

  it('proposes, activates, supersedes, and reads an attributed goal with replan evidence', async () => {
    const f = await harness()
    const proposed = await f.call('axiom.goal.propose', {
      missionId: f.mission.id,
      goal: { ...goal, objective: 'New objective' }
    })
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) {
      throw new Error(proposed.error.code)
    }
    const revision = z
      .object({ goalRevision: GoalRevisionSchema })
      .parse(proposed.result).goalRevision
    expect(revision.status).toBe('PROPOSED')
    const params = { missionId: f.mission.id, goalRevisionId: revision.id }
    expect(await f.call('axiom.goal.activate', params)).toMatchObject({
      ok: true,
      result: { goalRevision: { status: 'ACTIVE' } }
    })
    expect(
      await f.call('axiom.goal.show', params, { orchestrationContractVersion: undefined })
    ).toMatchObject({ ok: true, result: { goalRevision: { id: revision.id } } })
    expect(f.store.getGoalRevision(f.goalRevision.id)?.status).toBe('SUPERSEDED')
    expect(f.store.getMission(f.mission.id)?.activeGoalRevisionId).toBe(revision.id)
    expect(f.db.getRun(f.store.getMission(f.mission.id)!.runId)?.objective).toBe('New objective')
    expect(
      f.store
        .listAuditEvents({ missionId: f.mission.id })
        .some(
          (event) =>
            event.event === 'goal.activated' && JSON.stringify(event.after).includes('MAJOR_REPLAN')
        )
    ).toBe(true)
    expect(await f.call('axiom.goal.activate', params)).toMatchObject({
      ok: false,
      error: { code: 'goal_not_proposed' }
    })
  })

  it('rejects a goal from another Mission without changing either active revision', async () => {
    const f = await harness()
    const other = await f.call('axiom.mission.create', createParams)
    if (!other.ok) {
      throw new Error(other.error.code)
    }
    const second = z.object({ mission: MissionSummarySchema }).parse(other.result).mission
    expect(
      await f.call('axiom.goal.activate', {
        missionId: second.id,
        goalRevisionId: f.goalRevision.id
      })
    ).toMatchObject({ ok: false, error: { code: 'goal_revision_not_found' } })
    expect(f.store.getGoalRevision(f.goalRevision.id)?.status).toBe('ACTIVE')
  })
})
