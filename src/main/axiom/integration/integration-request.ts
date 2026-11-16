import { randomBytes } from 'node:crypto'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import type { AxiomStore } from '../db/axiom-store'
import type { ApplyEffect, IntegrationDependencies } from './integration-apply'
import { auditIntegration } from './integration-settlement'
import { removeIntegrationLeftovers } from './integration-scratch'
import { cancelIntegrationRegressions } from './integration-regression-state'

export function eligibility(store: AxiomStore, effect: ApplyEffect) {
  const mission = store.getMission(effect.missionId)
  const task = store.getTaskStage(effect.payload.taskId)
  const candidate = store.getCandidate(effect.payload.candidateId)
  if (
    !mission ||
    TERMINAL_MISSION_STATUSES.has(mission.status) ||
    !task ||
    task.missionId !== mission.id ||
    candidate?.missionId !== mission.id ||
    candidate.taskId !== task.taskId ||
    candidate.status !== 'ACTIVE' ||
    !(
      task.stage === 'INTEGRATION_READY' ||
      (task.stage === 'BLOCKED' && task.previousStage === 'INTEGRATION_READY')
    )
  ) {
    return { kind: 'done' } as const
  }
  const batches = store.listIntegrationBatches({ missionId: mission.id, candidateId: candidate.id })
  if (batches.some((b) => !['QUEUED', 'APPLYING', 'TESTING', 'SUPERSEDED'].includes(b.status))) {
    return { kind: 'done' } as const
  }
  if (
    task.stage === 'BLOCKED' ||
    mission.status !== 'EXECUTING' ||
    store.listOpenIntegrationBatches(mission.id).some((b) => b.candidateIds[0] !== candidate.id)
  ) {
    return { kind: 'later', later: new Date(Date.now() + 30_000).toISOString() } as const
  }
  const open = batches.filter(
    (b) => b.status === 'QUEUED' || b.status === 'APPLYING' || b.status === 'TESTING'
  )
  if (open.length > 1) {
    throw new Error('integration_batch_stale')
  }
  return { kind: 'ready', mission, task, candidate, batch: open[0] } as const
}

export function beginBatch(store: AxiomStore, effect: ApplyEffect, baseCommit: string) {
  return store.transaction('integration_begin', () => {
    const state = eligibility(store, effect)
    if (state.kind !== 'ready') {
      return state
    }
    let batch = state.batch
    if (
      (batch?.status === 'APPLYING' || batch?.status === 'TESTING') &&
      batch.baseCommit !== baseCommit
    ) {
      throw new Error('integration_head_moved')
    }
    if (batch?.status === 'TESTING') {
      return { ...state, batch }
    }
    if (batch?.status === 'QUEUED') {
      if (
        !store.transitionIntegrationBatch({
          id: batch.id,
          expectedStatus: 'QUEUED',
          status: 'APPLYING',
          baseCommit
        })
      ) {
        throw new Error('integration_batch_stale')
      }
      batch = store.getIntegrationBatch(batch.id)!
    } else if (!batch) {
      batch = store.insertIntegrationBatch({
        id: `batch_${randomBytes(16).toString('hex')}`,
        missionId: effect.missionId,
        candidateIds: [state.candidate.id],
        status: 'APPLYING',
        baseCommit
      })
    }
    auditIntegration(store, batch, 'integration.batch_started', {
      status: 'APPLYING',
      baseCommit,
      candidateId: state.candidate.id
    })
    return { ...state, batch }
  })
}

function abandonBatches(
  store: AxiomStore,
  batches: IntegrationBatch[],
  reason: 'request_stale' | 'integration_unavailable'
) {
  for (const batch of batches) {
    if (
      store.transitionIntegrationBatch({
        id: batch.id,
        expectedStatus: batch.status,
        status: 'SUPERSEDED'
      })
    ) {
      cancelIntegrationRegressions(store, batch, reason)
      auditIntegration(store, batch, 'integration.batch_abandoned', {
        status: 'SUPERSEDED',
        reason
      })
    }
  }
}

async function removeAbandonedScratch(deps: IntegrationDependencies, batches: IntegrationBatch[]) {
  for (const batch of batches) {
    try {
      await removeIntegrationLeftovers(deps.runtime, batch)
    } catch {
      /* Best effort after abandonment. */
    }
  }
}

export async function closeStaleIntegrationBatches(
  deps: IntegrationDependencies,
  missionId: string
) {
  const { store } = deps
  let batches: IntegrationBatch[]
  try {
    batches = store.transaction('integration_stale_batches', () => {
      const mission = store.getMission(missionId)
      const dead = store.listOpenIntegrationBatches(missionId).filter((batch) => {
        const candidate = store.getCandidate(batch.candidateIds[0])
        const task = candidate && store.getTaskStage(candidate.taskId)
        return (
          !mission ||
          TERMINAL_MISSION_STATUSES.has(mission.status) ||
          candidate?.status !== 'ACTIVE' ||
          candidate.missionId !== missionId ||
          task?.missionId !== missionId ||
          !(
            task.stage === 'INTEGRATION_READY' ||
            (task.stage === 'BLOCKED' && task.previousStage === 'INTEGRATION_READY')
          )
        )
      })
      abandonBatches(store, dead, 'request_stale')
      return dead
    })
  } catch {
    throw new Error('integration_batch_stale')
  }
  await removeAbandonedScratch(deps, batches)
}

export async function abandonIntegration(
  deps: IntegrationDependencies,
  effect: ApplyEffect
): Promise<void> {
  const { store, missions } = deps
  let batches: IntegrationBatch[] = []
  try {
    store.transaction('integration_abandoned', () => {
      batches = store
        .listOpenIntegrationBatches(effect.missionId)
        .filter((b) => b.candidateIds[0] === effect.payload.candidateId)
      abandonBatches(store, batches, 'integration_unavailable')
      const task = store.getTaskStage(effect.payload.taskId)
      if (task?.missionId === effect.missionId && task.stage === 'INTEGRATION_READY') {
        missions.transitionTaskStage({
          taskId: task.taskId,
          to: 'BLOCKED',
          actor: 'IntegrationController',
          reason: 'integration_unavailable'
        })
      }
    })
  } catch {
    /* The outbox calls this once; exhaustion must never reject its drain. */
  }
  await removeAbandonedScratch(deps, batches)
}
