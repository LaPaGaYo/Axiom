import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { VerificationRerunParams } from '../../../shared/axiom-contract/verification-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { MissionControllerError } from '../mission-controller/controller-context'
import { redactContext } from '../context-builder/redaction'
import { auditVerification } from './verification-claim'
import { activeCandidateVerification } from './verification-candidate'
import type { VerificationDependencies } from './verification-service'

export function rerunVerification(
  deps: Pick<VerificationDependencies, 'store' | 'missions'>,
  input: z.input<typeof VerificationRerunParams>,
  recordMutationReceipt?: (result: unknown) => void
) {
  const p = VerificationRerunParams.parse(input)
  const { store, missions } = deps
  return store.transaction('verification_rerun', () => {
    const task = store.getTaskStage(p.taskId)
    if (!task) {
      throw new MissionControllerError('task_not_found', { taskId: p.taskId })
    }
    const { candidate, latest } = activeCandidateVerification(store, task)
    if (
      !candidate ||
      (task.stage !== 'BLOCKED' &&
        !(task.stage === 'VERIFYING' && latest?.status === 'HUMAN_REVIEW')) ||
      latest?.status === 'QUEUED' ||
      latest?.status === 'RUNNING'
    ) {
      throw new MissionControllerError('illegal_transition', {
        taskId: task.taskId,
        from: task.stage,
        reason: 'task_not_rerunnable'
      })
    }
    if (redactContext(p.rationale).redacted) {
      throw new OrchestrationError('invalid_argument', 'secret_in_rationale')
    }
    if (
      latest?.status === 'HUMAN_REVIEW' &&
      !store.updateVerificationRun({
        id: latest.id,
        expectedStatus: 'HUMAN_REVIEW',
        status: 'CANCELED',
        verdictDetail: {
          ...latest.verdictDetail,
          rerun: { rationale: p.rationale, by: 'user', at: new Date().toISOString() }
        }
      })
    ) {
      throw new MissionControllerError('stale_state', { runId: latest.id })
    }
    const run = store.insertVerificationRun({
      id: `vrun_${randomUUID()}`,
      missionId: task.missionId,
      candidateId: candidate.id,
      taskId: task.taskId,
      status: 'QUEUED',
      verdictDetail: {},
      commands: [],
      toolVersions: {},
      verifier: 'VerificationService'
    })
    if (task.stage === 'BLOCKED') {
      missions.transitionTaskStage({
        taskId: task.taskId,
        to: 'VERIFYING',
        actor: 'user',
        reason: 'rerun_requested'
      })
    }
    auditVerification(deps, run, 'verification.rerun_requested', {
      taskId: task.taskId,
      candidateId: candidate.id,
      previousRunId: latest?.id ?? null,
      newRunId: run.id,
      rationale: p.rationale
    })
    const result = { runId: run.id, status: 'QUEUED' as const }
    recordMutationReceipt?.(result)
    return result
  })
}
