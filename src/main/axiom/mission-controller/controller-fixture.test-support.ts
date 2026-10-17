import {
  goal,
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import type { PlanProposal } from '../../../shared/axiom-contract/plan-proposal'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from '../db/axiom-store'
import { MissionController } from './mission-controller'

export const now = () => '2026-10-17T12:00:00Z'
export const sessionId = 'axiom-mission-00000000-0000-4000-8000-000000000001'
export const createInput = {
  repoId: 'repo',
  repoPath: '/repository',
  targetBranch: 'main',
  goal,
  provenance
}
export const actor = 'tester'

export function fixture(path = ':memory:') {
  const db = new OrchestrationDb(path)
  const store = new AxiomStore(db)
  const controller = new MissionController(db, store, { now, mintSessionId: () => sessionId })
  return { db, store, controller }
}

export function propose(
  controller: MissionController,
  missionId: string,
  goalRevisionId: string,
  proposal: PlanProposal = makeProposal()
) {
  return controller.proposePlan({
    missionId,
    planRevision: { ...proposal, goalRevisionId },
    provenance
  })
}

export function planned(f = fixture(), proposal: PlanProposal = makeProposal()) {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const plan = propose(f.controller, mission.id, goalRevision.id, proposal)
  f.controller.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance })
  return { ...f, missionId: mission.id, planId: plan.id }
}
