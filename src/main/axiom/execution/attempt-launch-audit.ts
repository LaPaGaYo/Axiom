import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { AdmittedAttempt } from '../scheduler/scheduler'
import type { AttemptLauncherDependencies } from './attempt-launcher'

export function createAttemptLaunchAudit(
  deps: AttemptLauncherDependencies,
  planner?: { goalRevisionId: string; runSeq: number }
) {
  return (
    attempt: AdmittedAttempt,
    event: string,
    dispatchId: string | null,
    after: AuditEvent['after']
  ) => {
    deps.store.appendAuditEvent({
      missionId: attempt.missionId,
      actor: planner ? 'MissionController' : 'Scheduler',
      event: planner ? event.replace('attempt.', 'planner.') : event,
      objectKind: 'attempt',
      objectId: dispatchId ?? `${attempt.taskId}/${attempt.seq}`,
      before: null,
      after: planner
        ? {
            missionId: attempt.missionId,
            goalRevisionId: planner.goalRevisionId,
            seq: planner.runSeq,
            branch: attempt.branch,
            provider: deps.store.getAgentSpec(attempt.agentSpecId)?.spec.provider ?? null,
            ...(typeof after === 'object' && after !== null && !Array.isArray(after) ? after : {})
          }
        : after,
      createdAt: deps.now?.() ?? new Date().toISOString()
    })
  }
}
