import { defineMethod } from '../../core'
import {
  VerificationShowParams,
  VerificationListParams,
  VerificationRunViewSchema,
  type VerificationRun
} from '../../../../../shared/axiom-contract/verification-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'
import type { AxiomStore } from '../../../../axiom/db/axiom-store'
import { OrchestrationError } from '../../../orchestration/orchestration-error'

function view(store: AxiomStore, run: VerificationRun) {
  const candidate = store.getCandidate(run.candidateId)
  if (!candidate) {
    throw new OrchestrationError('not_found', 'Verification Candidate is missing.')
  }
  return VerificationRunViewSchema.parse({
    ...run,
    candidateCommitSha: candidate.commitSha,
    candidateTreeSha: candidate.treeSha,
    phase: run.verdictDetail.phase ?? null
  })
}

export const AXIOM_VERIFICATION_METHODS = [
  defineMethod({
    name: 'axiom.verification.show',
    permission: 'workspace',
    params: VerificationShowParams,
    handler: (p, { runtime }) => {
      const { store } = getAxiomControlPlane(runtime)
      const run = store.getVerificationRun(p.runId)
      if (!run) {
        throw new OrchestrationError('not_found', 'VerificationRun was not found.')
      }
      return { run: view(store, run) }
    }
  }),
  defineMethod({
    name: 'axiom.verification.list',
    permission: 'workspace',
    params: VerificationListParams,
    handler: (p, { runtime }) => {
      const { store, missions } = getAxiomControlPlane(runtime)
      missions.getMission(p.missionId)
      return { runs: store.listVerificationRuns(p).map((run) => view(store, run)) }
    }
  })
]
