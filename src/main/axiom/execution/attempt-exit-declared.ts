import { z } from 'zod'
import type {
  HeadlessOutcome,
  HeadlessSubmissionReportSchema
} from '../../../shared/axiom-contract/submission-params'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { gitExecFileAsync } from '../../git/runner'
import { getAxiomControlPlane } from '../control-plane'
import { redactContext } from '../context-builder/redaction'
import { routeWorkerMessage } from '../messaging/message-router'
import { resolveHostAttempt } from './attempt-authority'
import { settleDeclaredAttempt } from './attempt-settlement'
import { scheduleFailedWorkerRelease } from './attempt-worker-release'

export async function settleDeclaredExit(
  runtime: OrcaRuntimeService,
  input: {
    attemptId: string
    worktree: string
    outcome: Exclude<HeadlessOutcome, { outcome: 'submitted' }>
    report: z.infer<typeof HeadlessSubmissionReportSchema>
    reportArtifactId: string
    artifactIds: string[]
    lastMessage: string
    eventAudit: Record<string, unknown>
  }
) {
  const db = runtime.getOrchestrationDb()
  const { store, missions } = getAxiomControlPlane(runtime)
  const { attemptId, outcome, report, artifactIds, reportArtifactId } = input
  // A declaration never snapshots the tree; changed files are evidence, not a submission gate.
  const status = await gitExecFileAsync(['status', '--porcelain'], { cwd: input.worktree })
  const worktreeChanged = status.stdout.split(/\r?\n/).filter(Boolean).length
  const paths =
    outcome.outcome === 'blocked'
      ? outcome.paths.slice(0, 50).map((text) => redactContext(text).content.slice(0, 500))
      : []
  const summary = redactContext(report.summary).content
  const missionId = store.transaction('headless_exit_declared', () => {
    const current = resolveHostAttempt(db, store, attemptId)
    const candidate = store
      .listCandidates(current.mission.id)
      .find((entry) => entry.taskId === current.task.taskId && entry.status === 'ACTIVE')
    db.failDispatch(attemptId, `Headless Worker declared ${outcome.outcome}`, {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    store.appendAuditEvent({
      missionId: current.mission.id,
      actor: 'AttemptSettlement',
      event: 'attempt.failed',
      objectKind: 'attempt',
      objectId: attemptId,
      before: null,
      after: {
        taskId: current.task.taskId,
        reason: 'process_exited',
        evidence: 'exit_code',
        exitCode: 0,
        settlement: {
          kind: outcome.outcome,
          reason: outcome.reason,
          ...(outcome.outcome === 'blocked' ? { paths } : {})
        },
        ...(candidate
          ? {
              candidate: {
                id: candidate.id,
                commitSha: candidate.commitSha,
                treeSha: candidate.treeSha
              }
            }
          : {}),
        worktreeChanged,
        reportArtifactId,
        artifactIds,
        reportSummary: summary.slice(0, 2000),
        limitations: report.limitations
          .slice(0, 20)
          .map((text) => redactContext(text).content.slice(0, 500)),
        lastMessageExcerpt: redactContext(input.lastMessage).content.slice(-2000),
        ...z
          .record(z.string(), z.json())
          .parse(JSON.parse(redactContext(JSON.stringify(input.eventAudit)).content))
      }
    })
    routeWorkerMessage(
      { runtime, db, store },
      {
        sender: current.sender,
        body: summary.slice(0, 4000),
        axiom: {
          version: 1,
          type: 'BLOCKED',
          missionId: current.mission.id,
          taskId: current.task.taskId,
          attemptId,
          summary: redactContext(
            `Attempt ${current.binding.seq} declared ${outcome.reason}${paths.length ? `: ${paths.join(', ')}` : ''}`
          ).content.slice(0, 2000),
          artifactIds: [reportArtifactId, ...artifactIds],
          related: { taskIds: [current.task.taskId] },
          blocked: { reason: outcome.reason, paths }
        }
      }
    )
    const settlement = settleDeclaredAttempt(
      { store, missions },
      { ...current.binding, dispatchId: attemptId, outcome, actor: 'AttemptSettlement' }
    )
    if (!settlement.settled) {
      throw new Error('Declared Attempt lost settlement authority')
    }
    return current.mission.id
  })
  scheduleFailedWorkerRelease(runtime, { missionId, attemptId })
  return 'declared' as const
}
