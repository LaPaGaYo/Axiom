import { afterEach, expect, it, vi } from 'vitest'
import { createParams, rpcFixture } from '../rpc-fixture.test-support'
import { MissionCreateResponseSchema } from '../../../shared/axiom-contract/mission-params'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { PlanResponseSchema } from '../../../shared/axiom-contract/plan-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import * as integration from './integration-base'
const fixtures: ReturnType<typeof rpcFixture>[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    f.db.close()
  }
})
it.each([true, false, 'failure'] as const)(
  'ensures the integration base before starting (%s)',
  async (outcome) => {
    const f = rpcFixture()
    fixtures.push(f)
    const created = await f.call('axiom.mission.create', createParams)
    if (!created.ok) {
      throw new Error(created.error.code)
    }
    const { mission, goalRevision } = MissionCreateResponseSchema.parse(created.result)
    const proposed = await f.call('axiom.plan.propose', {
      missionId: mission.id,
      planRevision: { ...makeProposal(), goalRevisionId: goalRevision.id },
      provenance
    })
    if (!proposed.ok) {
      throw new Error(proposed.error.code)
    }
    const { planRevision } = PlanResponseSchema.parse(proposed.result)
    await f.call('axiom.plan.approve', { planRevisionId: planRevision.id, resolver: 'test' })
    vi.mocked(integration.ensureIntegrationBase).mockImplementationOnce(async (input) => {
      expect(f.store.getMission(mission.id)?.status).toBe('PLANNED')
      expect(input).toEqual({ repoPath: '/fixture', targetBranch: 'main', missionId: mission.id })
      if (outcome === 'failure') {
        throw new OrchestrationError('integration_base_unavailable', 'Cannot create base')
      }
      return { sha: 'abc', created: outcome }
    })
    const result = await f.call('axiom.mission.start', { missionId: mission.id })
    if (outcome === 'failure') {
      expect(result).toMatchObject({ ok: false, error: { code: 'integration_base_unavailable' } })
      expect(f.store.getMission(mission.id)?.status).toBe('PLANNED')
      expect(f.store.listAttemptBindings({ missionId: mission.id })).toEqual([])
    } else {
      expect(result).toMatchObject({ ok: true, result: { mission: { status: 'EXECUTING' } } })
      expect(f.store.listAuditEvents({ missionId: mission.id })).toContainEqual(
        expect.objectContaining({
          event: outcome ? 'integration.base_created' : 'integration.base_reused',
          objectKind: 'mission',
          after: { sha: 'abc' }
        })
      )
    }
  }
)
