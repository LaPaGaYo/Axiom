import { afterEach, beforeEach, expect, it } from 'vitest'
import { z } from 'zod'
import { AxiomStore } from '../db/axiom-store'
import { fixture, createInput, propose, actor } from './controller-fixture.test-support'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'

let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
})
afterEach(() => f.db.close())

it.each(
  [[], [{ text: 'Looks right', check: { kind: 'human' as const } }]].map((acceptanceCriteria) => ({
    acceptanceCriteria
  }))
)(
  'rejects uncheckable acceptance atomically and accepts a correction in the same Mission',
  ({ acceptanceCriteria }) => {
    const { mission, goalRevision } = f.controller.createMission(createInput)
    const proposal = makeProposal()
    proposal.tasks[0].acceptanceCriteria = acceptanceCriteria
    const before = f.store.listAuditEvents({ missionId: mission.id })
    expect(() => propose(f.controller, mission.id, goalRevision.id, proposal)).toThrowError(
      expect.objectContaining({
        code: 'plan_invalid',
        data: {
          errors: [
            {
              code: 'acceptance_uncheckable',
              severity: 'error',
              message: 'Every Task needs at least one command or artifact acceptance criterion.',
              taskIds: ['T01'],
              path: ['tasks', 0, 'acceptanceCriteria']
            }
          ]
        }
      })
    )
    expect(f.store.listPlanRevisions(mission.id)).toEqual([])
    expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(before)
    expect(f.store.getMission(mission.id)?.status).toBe('ANALYZING')
    expect(propose(f.controller, mission.id, goalRevision.id).status).toBe('PROPOSED')
  }
)

it('rejects an out-of-range coverage index before persistence', () => {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const proposal = makeProposal()
  proposal.tasks[0].coversGoalCriteria = [1]
  expect(() => propose(f.controller, mission.id, goalRevision.id, proposal)).toThrowError(
    expect.objectContaining({
      code: 'plan_invalid',
      data: {
        errors: [
          {
            code: 'coverage_index_out_of_range',
            severity: 'error',
            message: 'Goal acceptance criterion index 1 is out of range (1 criteria).',
            taskIds: ['T01'],
            path: ['tasks', 0, 'coversGoalCriteria', 0]
          }
        ]
      }
    })
  )
  expect(f.store.listPlanRevisions(mission.id)).toEqual([])
})

it.each([false, true])(
  'persists advisory warnings and approval evidence (covered=%s)',
  (covered) => {
    const { mission, goalRevision } = f.controller.createMission({
      ...createInput,
      goal: { ...createInput.goal, acceptanceCriteria: ['first', 'second'] }
    })
    const proposal = makeProposal()
    // Match the frozen fixture's two shared entries without changing the ContextPackage fixtures.
    const shared = ['src/services/run-report.ts', 'src/services/reports.test.ts']
    proposal.tasks[2].scope.allowedPaths.push(...shared)
    proposal.tasks[7].scope.allowedPaths.push(...shared)
    if (covered) {
      proposal.tasks[0].coversGoalCriteria = [0, 1]
    }
    const warnings = [
      ...(!covered
        ? [
            {
              code: 'incomplete_coverage',
              message: 'Goal acceptance criteria are not covered by any Task: #0, #1',
              taskIds: [],
              uncovered: [
                { index: 0, text: 'first' },
                { index: 1, text: 'second' }
              ]
            }
          ]
        : []),
      {
        code: 'scope_overlap',
        message: 'Parallel Tasks T03 and T08 have overlapping allowedPaths.',
        taskIds: ['T03', 'T08'],
        paths: [
          { a: 'src/services/reports.test.ts', b: 'src/services/reports.test.ts' },
          { a: 'src/services/run-report.ts', b: 'src/services/run-report.ts' }
        ]
      }
    ]
    const plan = propose(f.controller, mission.id, goalRevision.id, proposal)
    expect(plan.warnings).toEqual(warnings)
    const row = z
      .object({ proposal: z.string() })
      .parse(f.db.db.prepare('SELECT proposal FROM plan_revisions WHERE id = ?').get(plan.id))
    expect(JSON.parse(row.proposal)).toEqual({ tasks: plan.tasks, edges: plan.edges, warnings })
    const reloaded = new AxiomStore(f.db)
    expect(reloaded.getPlanRevision(plan.id)).toEqual(plan)
    expect(f.controller.listPlans(mission.id)).toEqual([plan])
    expect(
      f.store
        .listAuditEvents({ missionId: mission.id })
        .find((event) => event.event === 'plan.proposed')?.after
    ).toEqual(plan)
    const approved = f.controller.approvePlan({
      planRevisionId: plan.id,
      resolver: actor,
      provenance
    })
    expect(approved.status).toBe('APPROVED')
    expect(approved.warnings).toEqual(warnings)
    expect(
      f.store
        .listAuditEvents({ missionId: mission.id })
        .find((event) => event.event === 'plan.approved')?.after
    ).toEqual({
      status: 'APPROVED',
      activePlanRevisionId: plan.id,
      provenance,
      warnings: warnings.map(({ code, taskIds }) => ({ code, taskIds })),
      coverage: { covered: covered ? 2 : 0, total: 2 }
    })
  }
)

it('loads older proposal blobs with empty warnings and never recomputes them on approval', () => {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const plan = propose(f.controller, mission.id, goalRevision.id)
  f.db.db
    .prepare('UPDATE plan_revisions SET proposal = ? WHERE id = ?')
    .run(JSON.stringify({ tasks: plan.tasks, edges: plan.edges }), plan.id)
  expect(new AxiomStore(f.db).getPlanRevision(plan.id)?.warnings).toEqual([])
  expect(
    f.controller.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance }).warnings
  ).toEqual([])
})
