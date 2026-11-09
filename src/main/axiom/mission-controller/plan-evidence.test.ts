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
    proposal.tasks[0].acceptanceCriteria = [
      { text: 'A person checks this', check: { kind: 'human' } },
      { text: 'Tests pass', check: { kind: 'command', command: 'Test results' } }
    ]
    expect(() => propose(f.controller, mission.id, goalRevision.id, proposal)).toThrowError(
      expect.objectContaining({
        code: 'plan_invalid',
        data: {
          errors: [
            {
              code: 'evidence_command_invalid',
              severity: 'error',
              message: 'Program "Test" is not allowed for acceptance commands.',
              path: ['tasks', 0, 'acceptanceCriteria', 1, 'check', 'command'],
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

it.each([
  [
    'required_evidence_retired',
    { requiredEvidence: ['pnpm test'] },
    ['tasks', 0, 'requiredEvidence']
  ],
  ['criterion_shape', { acceptanceCriteria: ['Tests pass'] }, ['tasks', 0, 'acceptanceCriteria', 0]]
])('rejects %s before inserting any PlanRevision', (code, patch, path) => {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const proposal = makeProposal()
  proposal.tasks[0] = { ...proposal.tasks[0], ...patch }
  expect(() => propose(f.controller, mission.id, goalRevision.id, proposal)).toThrowError(
    expect.objectContaining({
      code: 'plan_invalid',
      data: { errors: expect.arrayContaining([expect.objectContaining({ code, path })]) }
    })
  )
  expect(f.store.listPlanRevisions(mission.id)).toEqual([])
  expect(f.store.getMission(mission.id)?.status).toBe('ANALYZING')
})

it('keeps command shape validation on the original criterion when trimming would hide a newline', () => {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const proposal = makeProposal()
  proposal.tasks[0].acceptanceCriteria = [
    { text: 'Tests pass', check: { kind: 'command', command: 'pnpm test' } },
    { text: 'Duplicate with newline', check: { kind: 'command', command: '\npnpm test\n' } }
  ]
  expect(() => propose(f.controller, mission.id, goalRevision.id, proposal)).toThrowError(
    expect.objectContaining({
      code: 'plan_invalid',
      data: {
        errors: [
          expect.objectContaining({
            code: 'evidence_command_invalid',
            path: ['tasks', 0, 'acceptanceCriteria', 1, 'check', 'command']
          })
        ]
      }
    })
  )
  expect(f.store.listPlanRevisions(mission.id)).toEqual([])
})
