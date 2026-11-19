import { z } from 'zod'
import type { CompletionReport } from '../../../shared/axiom-contract/completion-report'
import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import { readVerdictRecord } from '../../../shared/axiom-contract/verdict-record'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import { auditReason } from '../read-models/waiting-context'
import { activeCandidateVerification } from '../verification/verification-candidate'

type ReportTask = CompletionReport['tasks'][number]
const Launch = z.object({
  channel: z.enum(['headless', 'tui']).optional(),
  posture: z.enum(['headless-sandboxed', 'tui-bypass']).optional()
})

function verification(store: AxiomStore, run: VerificationRun) {
  const verdict = readVerdictRecord(run.verdictDetail)
  const artifactIds = [
    ...(verdict.verdictArtifactId ? [verdict.verdictArtifactId] : []),
    ...verdict.evidenceArtifactIds
  ]
  const resolution = verdict.resolution
  return {
    runId: run.id,
    status: run.status,
    verifier: run.verifier,
    toolVersions: run.toolVersions,
    checks: verdict.checks.map(({ command, result, criteria }) => ({ command, result, criteria })),
    ...(resolution
      ? {
          resolution: {
            verdict: resolution.verdict,
            rationale: resolution.rationale,
            at: resolution.at
          }
        }
      : {}),
    artifacts: artifactIds.flatMap((id) => {
      const artifact = store.getArtifact(id)
      return artifact ? [{ id, sha256: artifact.sha256 }] : []
    })
  }
}

export function completionReportTask(
  store: AxiomStore,
  db: OrchestrationDb,
  task: TaskStageRecord
): ReportTask {
  const { taskId, missionId } = task
  const candidates = store.listCandidates(missionId).filter((c) => c.taskId === taskId)
  const candidateIds = new Set(candidates.map((c) => c.id))
  const batches = store
    .listIntegrationBatches({ missionId })
    .filter((batch) => batch.candidateIds.some((id) => candidateIds.has(id)))
  const attempts = store.listAttemptBindings({ missionId, taskId }).map((binding) => {
    const spec = store.getAgentSpec(binding.agentSpecId)?.spec
    if (!spec) {
      throw new Error('completion_report_agent_spec_missing')
    }
    const launch = binding.dispatchId
      ? store.getLatestReadModelAudit({
          missionId,
          objectKind: 'attempt',
          objectId: binding.dispatchId,
          events: ['attempt.started']
        })
      : undefined
    const candidate = candidates.find((c) => c.attemptId === binding.dispatchId)
    return {
      seq: binding.seq,
      branch: binding.branch,
      agentSpecId: binding.agentSpecId,
      contextPackageId: binding.contextPackageId,
      provider: spec.provider,
      model: spec.model,
      effort: spec.reasoning.effort,
      ...Launch.safeParse(launch?.after).data,
      ...(candidate ? { candidateId: candidate.id } : {})
    }
  })
  const cancelRationale =
    task.stage === 'CANCELED'
      ? auditReason(
          store.getLatestReadModelAudit({
            missionId,
            objectKind: 'task',
            objectId: taskId,
            events: ['task.stage'],
            stage: 'CANCELED'
          })
        )
      : undefined
  const runs = [
    ...store.listVerificationRuns({ missionId, taskId }),
    ...batches.flatMap((batch) =>
      store.listVerificationRuns({ missionId, taskId, batchId: batch.id })
    )
  ].map(({ id, candidateId, status, batchId }) => ({
    id,
    candidateId,
    status,
    ...(batchId ? { batchId } : {})
  }))
  const openQuestions = [
    ...store
      .listMessages({ missionId, taskId, pendingOnly: true })
      .flatMap((message) =>
        message.question !== undefined
          ? [{ source: 'message' as const, id: message.id, text: message.question }]
          : []
      ),
    ...db
      .listGates({ taskId, status: 'pending' })
      .map((gate) => ({ source: 'gate' as const, id: gate.id, text: gate.question }))
  ]
  const common = {
    taskId,
    planTaskId: task.spec.id,
    planRevisionId: task.planRevisionId,
    title: task.spec.title,
    kind: task.spec.kind,
    ...(cancelRationale !== undefined ? { cancelRationale } : {}),
    attempts,
    runs,
    openQuestions
  }
  if (task.stage !== 'INTEGRATED') {
    return { ...common, stage: task.stage }
  }
  const { candidate, latest } = activeCandidateVerification(store, task)
  const submission = candidate && store.getSubmissionByDispatch(candidate.attemptId)
  const batch = batches.at(-1)
  const regression = batch && store.listVerificationRuns({ missionId, batchId: batch.id }).at(-1)
  if (
    !candidate ||
    !latest ||
    !submission ||
    submission.candidateId !== candidate.id ||
    !batch?.mergeCommit ||
    !regression
  ) {
    throw new Error('completion_report_evidence_missing')
  }
  const { summary, limitations, risks, followUps } = submission.report
  return {
    ...common,
    stage: 'INTEGRATED',
    candidate: { id: candidate.id, commitSha: candidate.commitSha, treeSha: candidate.treeSha },
    summary,
    limitations,
    risks,
    followUps,
    verification: verification(store, latest),
    integration: {
      batchId: batch.id,
      baseCommit: batch.baseCommit,
      mergeCommit: batch.mergeCommit,
      regressionRunId: regression.id,
      regressionStatus: regression.status
    }
  }
}
