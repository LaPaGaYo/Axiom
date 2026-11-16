import { getMainE2EConfig } from '../../e2e-config'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { EffectOutbox } from '../outbox/effect-outbox'
import { activeCandidateVerification } from '../verification/verification-candidate'

export function shouldHoldIntegration(): boolean {
  return getMainE2EConfig().enabled && process.env.AXIOM_E2E_HOLD_INTEGRATION === '1'
}

export function requestIntegrations(
  store: AxiomStore,
  missions: Pick<MissionController, 'transitionTaskStage'>,
  effects: Pick<EffectOutbox, 'enqueue'>,
  missionId: string
): string[] {
  const requested: string[] = []
  const request = (taskId: string, stage: 'VERIFIED' | 'INTEGRATION_READY') => {
    try {
      const written = store.transaction('integration_requested', () => {
        const mission = store.getMission(missionId)
        const task = store.getTaskStage(taskId)
        if (
          mission?.status !== 'EXECUTING' ||
          !task ||
          task.missionId !== missionId ||
          task.stage !== stage ||
          shouldHoldIntegration()
        ) {
          return false
        }
        const { candidate, latest } = activeCandidateVerification(store, task)
        if (!candidate) {
          return false
        }
        let after: { taskId: string; again: boolean; runId?: string } = { taskId, again: true }
        if (stage === 'INTEGRATION_READY') {
          const effect = store.getEffect('integration.apply', candidate.id)
          // Re-enqueueing a pending request would erase its backoff and spent tries.
          if (effect?.status === 'pending' || effect?.status === 'running') {
            return false
          }
        } else {
          if (
            latest?.status !== 'PASS' ||
            !store.listUpstreamEdges(taskId).every((edge) => {
              const upstream = store.getTaskStage(edge.fromTaskId)
              return (
                upstream?.missionId === missionId &&
                upstream.planRevisionId === task.planRevisionId &&
                upstream.stage === 'INTEGRATED'
              )
            })
          ) {
            return false
          }
          missions.transitionTaskStage({
            taskId,
            to: 'INTEGRATION_READY',
            actor: 'IntegrationController',
            reason: 'integration_requested'
          })
          after = { taskId, runId: latest.id, again: false }
        }
        effects.enqueue({
          missionId,
          kind: 'integration.apply',
          key: candidate.id,
          payload: { taskId, candidateId: candidate.id }
        })
        store.appendAuditEvent({
          missionId,
          actor: 'IntegrationController',
          objectKind: 'candidate',
          objectId: candidate.id,
          event: 'integration.requested',
          before: null,
          after
        })
        return true
      })
      if (written) {
        requested.push(taskId)
      }
    } catch {
      console.warn('[axiom] Integration request failed', { missionId, taskId })
    }
  }
  try {
    if (store.getMission(missionId)?.status !== 'EXECUTING' || shouldHoldIntegration()) {
      return requested
    }
    for (const task of store.listTaskStages({ missionId, stage: 'INTEGRATION_READY' })) {
      request(task.taskId, 'INTEGRATION_READY')
    }
    const verified = store.listTaskStages({ missionId, stage: 'VERIFIED' }).map(({ taskId }) => ({
      taskId,
      sequence:
        store.getLatestReadModelAudit({
          missionId,
          objectKind: 'task',
          objectId: taskId,
          events: ['task.stage'],
          stage: 'VERIFIED'
        })?.sequence ?? Number.MAX_SAFE_INTEGER
    }))
    verified.sort((a, b) => a.sequence - b.sequence || (a.taskId < b.taskId ? -1 : 1))
    for (const task of verified) {
      request(task.taskId, 'VERIFIED')
    }
  } catch {
    console.warn('[axiom] Integration request failed', { missionId })
  }
  return requested
}
