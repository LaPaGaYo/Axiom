import type { SubmissionReport } from '../../../shared/axiom-contract/submission-params'
import type { AxiomMessagePayload } from '../../../shared/axiom-contract/message-params'
import type { OrchestrationCallerIdentity } from '../../runtime/orchestration/orchestration-caller-identity'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { AxiomStore } from '../db/axiom-store'
import { routeWorkerMessage } from '../messaging/message-router'

/** Called inside axiom_submit; items survive the asking Attempt, never a rolled-back Submission. */
export function routeSubmissionItems(
  ctx: { db: OrchestrationDb; store: AxiomStore },
  submission: {
    id: string
    missionId: string
    taskId: string
    attemptId: string
    report: SubmissionReport
  },
  sender: OrchestrationCallerIdentity
) {
  const { id: submissionId, missionId, taskId, attemptId, report } = submission
  const fields = {
    version: 1 as const,
    missionId,
    taskId,
    attemptId,
    artifactIds: [],
    related: { taskIds: [taskId], submissionId }
  }
  const route = (axiom: AxiomMessagePayload['axiom']) =>
    routeWorkerMessage(
      // All items target this Run. SUBMISSION publication wakes it only after settlement commits.
      { ...ctx, runtime: { notifyMessageArrived: () => {} } },
      { axiom, sender }
    )
  for (const text of report.questions.slice(0, 10)) {
    route({ ...fields, type: 'QUESTION', summary: text, question: { text, options: [] } })
  }
  for (const text of report.followUps.slice(0, 10)) {
    route({ ...fields, type: 'REQUEST', summary: text, followUp: { text } })
  }
  const questions = Math.max(0, report.questions.length - 10)
  const followUps = Math.max(0, report.followUps.length - 10)
  if (questions || followUps) {
    ctx.store.appendAuditEvent({
      missionId,
      actor: 'AttemptSettlement',
      objectKind: 'submission',
      objectId: submissionId,
      event: 'submission.items_truncated',
      before: null,
      after: { questions, followUps }
    })
  }
}
