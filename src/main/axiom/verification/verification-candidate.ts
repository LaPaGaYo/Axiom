import { z } from 'zod'
import {
  VerificationRerunParams,
  type VerificationRun
} from '../../../shared/axiom-contract/verification-params'
import type { AxiomStore } from '../db/axiom-store'

const RerunAudit = VerificationRerunParams.extend({
  candidateId: z.string(),
  previousRunId: z.string().nullable(),
  newRunId: z.string()
})

export function findVerificationRerun(store: AxiomStore, run: VerificationRun) {
  for (const event of store.listAuditEvents({ missionId: run.missionId })) {
    if (
      event.event !== 'verification.rerun_requested' ||
      event.objectKind !== 'verification_run' ||
      event.objectId !== run.id
    ) {
      continue
    }
    const parsed = RerunAudit.safeParse(event.after)
    if (
      parsed.success &&
      parsed.data.newRunId === run.id &&
      parsed.data.taskId === run.taskId &&
      parsed.data.candidateId === run.candidateId
    ) {
      return parsed.data
    }
  }
  return undefined
}

export function activeCandidateVerification(
  store: AxiomStore,
  task: { taskId: string; missionId: string }
) {
  const candidate = store
    .listCandidates(task.missionId)
    .find((entry) => entry.taskId === task.taskId && entry.status === 'ACTIVE')
  const runs = candidate
    ? store.listVerificationRuns({
        missionId: task.missionId,
        taskId: task.taskId,
        candidateId: candidate.id
      })
    : []
  return { candidate, latest: runs.at(-1) }
}
