import { expect, it } from 'vitest'
import { PlanRevisionSchema } from '../shared/axiom-contract/mission-objects'
import { makeProposal } from '../shared/axiom-contract/contract-fixtures.test-support'
import { formatPlan } from './axiom-format'

const planRevision = PlanRevisionSchema.parse({
  ...makeProposal(),
  id: 'plan-1',
  missionId: 'mission-1',
  revision: 1,
  status: 'APPROVED'
})
it('prints persisted warning details and declared coverage after the plan table', () => {
  const plan = PlanRevisionSchema.parse({
    ...planRevision,
    warnings: [
      {
        code: 'incomplete_coverage',
        message: 'Missing',
        taskIds: [],
        uncovered: [{ index: 2, text: 'third' }]
      },
      {
        code: 'scope_overlap',
        message: 'Shared',
        taskIds: ['T03', 'T08'],
        paths: [
          { a: 'src/services/run-report.ts', b: 'src/services/run-report.ts' },
          { a: 'src/services/reports.test.ts', b: 'src/services/reports.test.ts' }
        ]
      },
      {
        code: 'insufficient_parallel_roots',
        message: 'Roots',
        taskIds: ['T01'],
        expected: 2,
        found: 1
      }
    ]
  })
  expect(
    formatPlan({
      planRevision: plan,
      coverage: {
        criteria: [
          { index: 0, text: 'first', taskIds: ['T01', 'T04'] },
          { index: 2, text: 'third', taskIds: [] }
        ],
        uncovered: [2]
      }
    })
  ).toBe(
    [
      'ID\tSTATUS\tTITLE',
      'plan-1\tAPPROVED\tRevision 1',
      'WARNINGS',
      '[incomplete_coverage] uncovered: #2 "third"',
      '[scope_overlap] T03 ∥ T08: src/services/run-report.ts, src/services/reports.test.ts',
      '[insufficient_parallel_roots] T01: expected 2, found 1',
      'COVERAGE',
      '#0 "first" ← T01, T04',
      '#2 "third" ← (none)'
    ].join('\n')
  )
})
it('prints none for empty warnings and coverage', () => {
  expect(formatPlan({ planRevision, coverage: { criteria: [], uncovered: [] } })).toBe(
    'ID\tSTATUS\tTITLE\nplan-1\tAPPROVED\tRevision 1\nWARNINGS\nnone\nCOVERAGE\nnone'
  )
})
it('distinguishes unequal overlapping entries and safely quotes criterion text', () => {
  const plan = PlanRevisionSchema.parse({
    ...planRevision,
    warnings: [
      {
        code: 'scope_overlap',
        message: 'Shared',
        taskIds: ['T01', 'T02'],
        paths: [{ a: 'src', b: 'src/a.ts' }]
      }
    ]
  })
  const text = formatPlan({
    planRevision: plan,
    coverage: { criteria: [{ index: 0, text: 'a\n"b"', taskIds: [] }], uncovered: [0] }
  })
  expect(text).toContain('[scope_overlap] T01 ∥ T02: src ∩ src/a.ts')
  expect(text).toContain('#0 "a\\n\\"b\\"" ← (none)')
})
