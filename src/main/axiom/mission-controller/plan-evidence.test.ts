import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture, createInput, propose } from './controller-fixture.test-support'
import { makeProposal } from '../../../shared/axiom-contract/contract-fixtures.test-support'

let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
})
afterEach(() => f.db.close())
it.each([false, true])(
  'rejects prose with an exact path before inserting a PlanRevision (legacy=%s)',
  (legacy) => {
    const { mission, goalRevision } = f.controller.createMission(createInput)
    const verificationRules: Record<string, boolean> = legacy ? { invalidLegacyKey: true } : {}
    f.store.upsertPolicy(mission.id, { ...f.store.getPolicy(mission.id)!, verificationRules })
    const proposal = makeProposal()
    proposal.tasks[0].requiredEvidence = ['Test results']
    expect(() => propose(f.controller, mission.id, goalRevision.id, proposal)).toThrowError(
      expect.objectContaining({
        code: 'plan_invalid',
        data: {
          errors: [
            {
              code: 'evidence_command_invalid',
              severity: 'error',
              message: 'Program "Test" is not allowed for requiredEvidence commands.',
              path: ['tasks', 0, 'requiredEvidence', 0],
              taskIds: ['T01']
            }
          ]
        }
      })
    )
    expect(f.store.listPlanRevisions(mission.id)).toEqual([])
    expect(f.store.getMission(mission.id)?.status).toBe('ANALYZING')
  }
)
