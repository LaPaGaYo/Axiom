import { randomBytes } from 'node:crypto'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { EffectOutbox } from '../outbox/effect-outbox'
import type { EffectOf } from '../../../shared/axiom-contract/effects'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import { pinCandidateRef, pinCommit } from '../execution/commit-pin'
import { auditIntegration, settleIntegrationConflict } from './integration-settlement'
import { mergeIntegrationCandidate } from './integration-merge'
import {
  readIntegrationHead,
  createIntegrationScratch,
  detachIntegrationScratch,
  removeIntegrationLeftovers,
  returnIntegrationScratch,
  type IntegrationRuntime
} from './integration-scratch'

type IntegrationDependencies = {
  store: AxiomStore
  missions: MissionController
  effects: EffectOutbox
  runtime: IntegrationRuntime
}
type ApplyEffect = EffectOf<'integration.apply'>

function eligibility(store: AxiomStore, effect: ApplyEffect) {
  const mission = store.getMission(effect.missionId)
  const task = store.getTaskStage(effect.payload.taskId)
  const candidate = store.getCandidate(effect.payload.candidateId)
  if (
    !mission ||
    ['COMPLETED', 'FAILED', 'CANCELED'].includes(mission.status) ||
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
  if (batches.some((b) => !['QUEUED', 'APPLYING', 'SUPERSEDED'].includes(b.status))) {
    return { kind: 'done' } as const
  }
  if (
    task.stage === 'BLOCKED' ||
    mission.status !== 'EXECUTING' ||
    store.listOpenIntegrationBatches(mission.id).some((b) => b.candidateIds[0] !== candidate.id)
  ) {
    return { kind: 'later', later: new Date(Date.now() + 30_000).toISOString() } as const
  }
  const open = batches.filter((b) => b.status === 'QUEUED' || b.status === 'APPLYING')
  if (open.length > 1) {
    throw new Error('integration_batch_stale')
  }
  return { kind: 'ready', mission, task, candidate, batch: open[0] } as const
}

function beginBatch(store: AxiomStore, effect: ApplyEffect, baseCommit: string) {
  return store.transaction('integration_begin', () => {
    const state = eligibility(store, effect)
    if (state.kind !== 'ready') {
      return state
    }
    let batch = state.batch
    if (batch?.status === 'APPLYING' && batch.baseCommit !== baseCommit) {
      throw new Error('integration_head_moved')
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

async function applyIntegration(deps: IntegrationDependencies, effect: ApplyEffect) {
  const { store, runtime } = deps
  const initial = eligibility(store, effect)
  if (initial.kind === 'done') {
    return 'done' as const
  }
  if (initial.kind === 'later') {
    return { later: initial.later }
  }
  const head = await readIntegrationHead(runtime, initial.mission)
  const state = beginBatch(store, effect, head)
  if (state.kind === 'done') {
    return 'done' as const
  }
  if (state.kind === 'later') {
    return { later: state.later }
  }
  const { batch, mission, candidate, task } = state
  await removeIntegrationLeftovers(runtime, batch)
  const scratch = await createIntegrationScratch(runtime, mission, batch, task.taskId)
  let failure: { error: unknown } | undefined
  try {
    await detachIntegrationScratch(scratch, batch.baseCommit)
    if (!(await pinCandidateRef(scratch.id, candidate.id, candidate.commitSha)).pinned) {
      throw new Error('candidate_unpinned')
    }
    const result = await mergeIntegrationCandidate(scratch.cwd, batch, candidate)
    if (result.kind === 'merged') {
      const ref = `refs/axiom/batches/${batch.id}/merged`
      if (!(await pinCommit({ cwd: scratch.cwd, ref, commitSha: result.mergeCommit })).pinned) {
        throw new Error('merged_ref_conflict')
      }
      store.transaction('integration_merged', () => {
        if (
          !store.transitionIntegrationBatch({
            id: batch.id,
            expectedStatus: 'APPLYING',
            status: 'TESTING',
            mergeCommit: result.mergeCommit
          })
        ) {
          throw new Error('integration_batch_stale')
        }
        auditIntegration(store, batch, 'integration.batch_merged', {
          status: 'TESTING',
          mergeCommit: result.mergeCommit,
          ref
        })
      })
    } else {
      store.transaction('integration_conflict', () => {
        if (
          !store.transitionIntegrationBatch({
            id: batch.id,
            expectedStatus: 'APPLYING',
            status: 'CONFLICT',
            conflicts: result.conflicts
          })
        ) {
          throw new Error('integration_batch_stale')
        }
        settleIntegrationConflict(deps, effect.payload)
        auditIntegration(store, batch, 'integration.batch_conflict', {
          status: 'CONFLICT',
          conflictCount: result.conflictCount,
          truncated: result.truncated
        })
      })
    }
  } catch (error) {
    failure = { error }
  }
  try {
    await returnIntegrationScratch(runtime, store, batch, scratch)
  } catch (error) {
    // A failed cleanup audit must not replace the original failed try.
    failure ??= { error }
  }
  if (failure) {
    throw failure.error
  }
  return 'done' as const
}

async function abandonIntegration(
  deps: IntegrationDependencies,
  effect: ApplyEffect
): Promise<void> {
  const { store, missions, runtime } = deps
  let batches: IntegrationBatch[] = []
  try {
    store.transaction('integration_abandoned', () => {
      batches = store
        .listOpenIntegrationBatches(effect.missionId)
        .filter((b) => b.candidateIds[0] === effect.payload.candidateId)
      for (const batch of batches) {
        if (
          store.transitionIntegrationBatch({
            id: batch.id,
            expectedStatus: batch.status,
            status: 'SUPERSEDED'
          })
        ) {
          auditIntegration(store, batch, 'integration.batch_abandoned', {
            status: 'SUPERSEDED',
            reason: 'integration_unavailable'
          })
        }
      }
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
  for (const batch of batches) {
    try {
      await removeIntegrationLeftovers(runtime, batch)
    } catch {
      /* Best effort after exhaustion. */
    }
  }
}

export function registerIntegrationApply(deps: IntegrationDependencies): void {
  deps.effects.register('integration.apply', {
    execute: (effect) => applyIntegration(deps, effect),
    maxAttempts: 3,
    backoffMs: [1000, 5000],
    onOrphan: () => 'retry',
    onExhausted: (effect) => abandonIntegration(deps, effect)
  })
}
