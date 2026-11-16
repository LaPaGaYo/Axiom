import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import { advanceIntegrationHead } from '../execution/integration-base'
import type { ApplyEffect, IntegrationDependencies } from './integration-apply'
import { integrationRepository } from './integration-head'
import { readIntegrationHead } from './integration-scratch'
import { auditIntegration } from './integration-settlement'

function integrateBatchTask(deps: IntegrationDependencies, batch: IntegrationBatch): boolean {
  const candidate = deps.store.getCandidate(batch.candidateIds[0])
  const task = candidate && deps.store.getTaskStage(candidate.taskId)
  if (
    candidate?.status !== 'ACTIVE' ||
    candidate.missionId !== batch.missionId ||
    task?.missionId !== batch.missionId ||
    task.stage !== 'INTEGRATION_READY'
  ) {
    return false
  }
  deps.missions.transitionTaskStage({
    taskId: task.taskId,
    to: 'INTEGRATED',
    actor: 'IntegrationController',
    reason: 'integration_promoted'
  })
  return true
}

function recordPromotion(
  deps: IntegrationDependencies,
  batch: IntegrationBatch,
  caughtUp: boolean
) {
  const { store } = deps
  try {
    const mergeCommit = batch.mergeCommit
    if (!mergeCommit) {
      throw new Error('integration_batch_stale')
    }
    store.transaction('integration_promoted', () => {
      if (
        !store.transitionIntegrationBatch({
          id: batch.id,
          expectedStatus: 'PROMOTABLE',
          status: 'PROMOTED'
        })
      ) {
        throw new Error('integration_batch_stale')
      }
      const taskIntegrated = integrateBatchTask(deps, batch)
      auditIntegration(store, batch, 'integration.batch_promoted', {
        status: 'PROMOTED',
        baseCommit: batch.baseCommit,
        mergeCommit,
        taskIntegrated,
        caughtUp
      })
    })
  } catch {
    throw new Error('integration_batch_stale')
  }
}

/** Runs before stale cleanup; exhaustion uses the same ref-authoritative settlement. */
export async function catchUpIntegrationPromotions(
  deps: IntegrationDependencies,
  missionId: string,
  candidateId?: string
): Promise<string | undefined> {
  let batches: IntegrationBatch[]
  let mission
  try {
    batches = deps.store
      .listOpenIntegrationBatches(missionId)
      .filter(
        (batch) =>
          batch.status === 'PROMOTABLE' && (!candidateId || batch.candidateIds[0] === candidateId)
      )
    mission = deps.store.getMission(missionId)
  } catch {
    throw new Error('integration_batch_stale')
  }
  if (!batches.length) {
    return undefined
  }
  if (!mission) {
    throw new Error('integration_head_unavailable')
  }
  const head = await readIntegrationHead(deps.runtime, mission)
  for (const batch of batches) {
    if (batch.mergeCommit === head) {
      recordPromotion(deps, batch, true)
    }
  }
  return head
}

/** A human may have unblocked an already promoted Task, even while its Mission is paused. */
export function finishPromotedRequest(deps: IntegrationDependencies, effect: ApplyEffect): boolean {
  try {
    const batch = deps.store
      .listIntegrationBatches({
        missionId: effect.missionId,
        candidateId: effect.payload.candidateId
      })
      .find((b) => b.status === 'PROMOTED')
    if (!batch) {
      return false
    }
    deps.store.transaction('integration_promoted_task', () => {
      const candidate = deps.store.getCandidate(effect.payload.candidateId)
      if (candidate?.taskId === effect.payload.taskId) {
        integrateBatchTask(deps, batch)
      }
    })
    return true
  } catch {
    throw new Error('integration_batch_stale')
  }
}

export async function promoteIntegration(
  deps: IntegrationDependencies,
  effect: ApplyEffect,
  batch: IntegrationBatch
) {
  let mission
  let current
  try {
    mission = deps.store.getMission(effect.missionId)
    const task = deps.store.getTaskStage(effect.payload.taskId)
    const candidate = deps.store.getCandidate(effect.payload.candidateId)
    current = deps.store.getIntegrationBatch(batch.id)
    if (
      mission?.status !== 'EXECUTING' ||
      task?.stage !== 'INTEGRATION_READY' ||
      task.missionId !== mission.id ||
      candidate?.status !== 'ACTIVE' ||
      candidate.missionId !== mission.id ||
      candidate.taskId !== task.taskId ||
      current?.status !== 'PROMOTABLE' ||
      current.missionId !== mission.id ||
      current.candidateIds[0] !== candidate.id
    ) {
      return { later: new Date().toISOString() }
    }
  } catch {
    throw new Error('integration_batch_stale')
  }
  if (!current.mergeCommit) {
    throw new Error('integration_batch_stale')
  }
  const repoPath = await integrationRepository(deps.runtime, mission)
  const result = await advanceIntegrationHead({
    repoPath,
    missionId: mission.id,
    from: current.baseCommit,
    to: current.mergeCommit
  })
  if (!result.advanced) {
    const codes = {
      checked_out: 'integration_branch_checked_out',
      moved: 'integration_head_moved',
      unavailable: 'integration_head_unavailable'
    }
    throw new Error(codes[result.reason])
  }
  recordPromotion(deps, current, false)
  return 'done' as const
}
