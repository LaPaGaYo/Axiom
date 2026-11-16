import { afterEach, expect, it, vi } from 'vitest'
import { MissionCreateResponseSchema } from '../../shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../shared/axiom-contract/plan-params'
import {
  makeProposal,
  provenance
} from '../../shared/axiom-contract/contract-fixtures.test-support'
import { rpcFixture, createParams } from './rpc-fixture.test-support'

afterEach(() => vi.restoreAllMocks())

it('refuses a rejection whose reason looks like a secret and writes nothing', async () => {
  const f = rpcFixture()
  try {
    const created = await f.call('axiom.mission.create', createParams)
    if (!created.ok) {
      throw new Error('Mission fixture failed')
    }
    const { mission, goalRevision } = MissionCreateResponseSchema.parse(created.result)
    const proposed = await f.call('axiom.plan.propose', {
      missionId: mission.id,
      planRevision: { ...makeProposal(), goalRevisionId: goalRevision.id },
      provenance
    })
    if (!proposed.ok) {
      throw new Error('Plan fixture failed')
    }
    const plan = PlanResponseSchema.parse(proposed.result).planRevision
    const before = f.store.listAuditEvents({ missionId: mission.id })
    const secret = ['ghp', 'a'.repeat(30)].join('_')
    const params = { planRevisionId: plan.id, resolver: 'user', reason: `Remove ${secret}` }
    const refused = await f.call('axiom.plan.reject', params)
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'secret_in_rationale' }
    })
    expect(JSON.stringify(refused)).not.toContain(secret)
    expect(f.store.getPlanRevision(plan.id)).toEqual(plan)
    expect(f.store.getPlanRevision(plan.id)?.status).toBe('PROPOSED')
    expect(f.store.getMission(mission.id)?.status).toBe('PLAN_REVIEW')
    expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(before)
    const accepted = await f.call('axiom.plan.reject', {
      ...params,
      reason: 'Narrow the scope.'
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) {
      throw new Error('Ordinary rejection refused')
    }
    expect(PlanResponseSchema.parse(accepted.result).planRevision.status).toBe('REJECTED')
  } finally {
    f.db.close()
  }
})
