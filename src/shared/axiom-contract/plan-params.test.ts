import { describe, expect, it } from 'vitest'
import {
  PlanApproveParams,
  PlanListParams,
  PlanProposeParams,
  PlanRejectParams,
  PlanShowParams
} from './plan-params'
import { makeProposal } from './contract-fixtures.test-support'

const { provenance, ...planRevision } = makeProposal()
describe('axiom.plan params', () => {
  it.each([
    [
      'propose',
      PlanProposeParams,
      { missionId: 'm', planRevision, provenance },
      { missionId: 'm', planRevision, provenance: {} }
    ],
    [
      'approve',
      PlanApproveParams,
      { planRevisionId: 'p', resolver: 'henry' },
      { planRevisionId: 'p', resolver: '' }
    ],
    [
      'reject',
      PlanRejectParams,
      { planRevisionId: 'p', resolver: 'henry', reason: 'Revise' },
      { planRevisionId: '', resolver: 'henry' }
    ],
    ['list', PlanListParams, { missionId: 'm' }, {}],
    ['show', PlanShowParams, { planRevisionId: 'p' }, { planRevisionId: 2 }]
  ])('%s accepts valid and rejects invalid params', (_, schema, valid, invalid) => {
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse(invalid).success).toBe(false)
  })
})
