import type { ArtifactStore } from '../artifacts/artifact-store'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { EffectOutbox } from '../outbox/effect-outbox'
import type { EffectOf } from '../../../shared/axiom-contract/effects'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import { pinCandidateRef, pinCommit } from '../execution/commit-pin'
import { auditIntegration, settleIntegrationConflict } from './integration-settlement'
import { mergeIntegrationCandidate } from './integration-merge'
import {
  eligibility,
  beginBatch,
  closeStaleIntegrationBatches,
  abandonIntegration
} from './integration-request'
import { runIntegrationRegression } from './integration-regression'
import {
  readIntegrationHead,
  createIntegrationScratch,
  detachIntegrationScratch,
  removeIntegrationLeftovers,
  returnIntegrationScratch,
  type IntegrationRuntime
} from './integration-scratch'

export type IntegrationDependencies = {
  artifacts: ArtifactStore
  store: AxiomStore
  missions: MissionController
  effects: EffectOutbox
  runtime: IntegrationRuntime
}
export type ApplyEffect = EffectOf<'integration.apply'>

async function applyIntegration(
  deps: IntegrationDependencies,
  effect: ApplyEffect,
  signal: AbortSignal
) {
  const { store, runtime } = deps
  await closeStaleIntegrationBatches(deps, effect.missionId)
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
  let regression: 'done' | 'stopped' | 'interrupted' = 'done'
  let testing: IntegrationBatch | undefined = batch.status === 'TESTING' ? batch : undefined
  try {
    await detachIntegrationScratch(
      scratch,
      batch.baseCommit,
      batch.status === 'TESTING' ? batch.mergeCommit! : undefined
    )
    if (batch.status !== 'TESTING') {
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
        testing = { ...batch, status: 'TESTING', mergeCommit: result.mergeCommit }
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
    }
    if (testing) {
      regression = await runIntegrationRegression(deps, {
        batch: testing,
        task,
        effect,
        cwd: scratch.cwd,
        signal
      })
    }
  } catch (error) {
    failure = { error }
  }
  if (regression === 'stopped') {
    return { later: new Date().toISOString() }
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
  return regression === 'interrupted' ? { later: new Date().toISOString() } : ('done' as const)
}

export function registerIntegrationApply(deps: IntegrationDependencies): void {
  deps.effects.register('integration.apply', {
    execute: (effect, { signal }) => applyIntegration(deps, effect, signal),
    maxAttempts: 3,
    backoffMs: [1000, 5000],
    onOrphan: () => 'retry',
    onExhausted: (effect) => abandonIntegration(deps, effect)
  })
}
