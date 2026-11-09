import { expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  fixture,
  createInput,
  propose,
  actor
} from '../../../src/main/axiom/mission-controller/controller-fixture.test-support'
import { provenance } from '../../../src/shared/axiom-contract/contract-fixtures.test-support'
import { AxiomStore } from '../../../src/main/axiom/db/axiom-store'
import { fixturePlanProposal } from './fixture-plan-proposal'
import { planCoverage } from '../../../src/shared/axiom-contract/plan-coverage'
import { formatPlan } from '../../../src/cli/axiom-format'

// The controlled fixture stays external and pinned; only read its frozen decomposition.
it.runIf(process.env.AXIOM_FIXTURE_REPO)(
  'persists exactly the frozen fixture overlap and approval receipt',
  () => {
    const repo = process.env.AXIOM_FIXTURE_REPO
    if (!repo) {
      throw new Error('Missing controlled fixture repository')
    }
    const f = fixture()
    try {
      const { mission, goalRevision } = f.controller.createMission({
        ...createInput,
        goal: { ...createInput.goal, acceptanceCriteria: [] }
      })
      const proposal = fixturePlanProposal(
        JSON.parse(readFileSync(path.join(repo, 'scenarios/goal/decomposition.json'), 'utf8')),
        goalRevision.id,
        provenance.at
      )
      const plan = propose(f.controller, mission.id, goalRevision.id, proposal)
      const warnings = [
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
      expect(new AxiomStore(f.db).getPlanRevision(plan.id)?.warnings).toEqual(warnings)
      const approved = f.controller.approvePlan({
        planRevisionId: plan.id,
        resolver: actor,
        provenance
      })
      const coverage = planCoverage(approved, goalRevision.acceptanceCriteria)
      expect(coverage).toEqual({ criteria: [], uncovered: [] })
      const approval = f.store
        .listAuditEvents({ missionId: mission.id })
        .find((event) => event.event === 'plan.approved')
      expect(approval?.after).toEqual({
        status: 'APPROVED',
        activePlanRevisionId: plan.id,
        provenance,
        warnings: [{ code: 'scope_overlap', taskIds: ['T03', 'T08'] }],
        coverage: { covered: 0, total: 0 }
      })
      const text = formatPlan({ planRevision: approved, coverage })
      expect(text).toContain(
        '[scope_overlap] T03 ∥ T08: src/services/reports.test.ts, src/services/run-report.ts\nCOVERAGE\nnone'
      )
      if (process.env.AXIOM_PROPOSAL_EVIDENCE) {
        writeFileSync(
          process.env.AXIOM_PROPOSAL_EVIDENCE,
          JSON.stringify({ warnings: approved.warnings, approval, coverage, text }, null, 2)
        )
      }
    } finally {
      f.db.close()
    }
  }
)
