import { randomUUID } from 'node:crypto'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import type { AxiomStore } from '../db/axiom-store'
import type { VerificationVerdict } from '../verification/verification-verdict'
import type { ApplyEffect, IntegrationDependencies } from './integration-apply'
import { auditIntegration, settleIntegrationConflict } from './integration-settlement'

export class RegressionInterrupted extends Error {
  constructor(readonly kind: 'stopped' | 'interrupted') {
    super(kind)
  }
}

export function regressionFence(run: VerificationRun) {
  return {
    id: run.id,
    expectedStatus: 'RUNNING' as const,
    expectedRuntimeEpoch: run.runtimeEpoch,
    expectedClaimCount: run.claimCount
  }
}

export function assertRegressionCurrent(
  store: AxiomStore,
  batch: IntegrationBatch,
  effect: ApplyEffect,
  signal: AbortSignal,
  run?: VerificationRun
): void {
  if (signal.aborted) {
    throw new RegressionInterrupted('stopped')
  }
  const mission = store.getMission(batch.missionId)
  const currentBatch = store.getIntegrationBatch(batch.id)
  const task = store.getTaskStage(effect.payload.taskId)
  const candidate = store.getCandidate(effect.payload.candidateId)
  const currentRun = run && store.getVerificationRun(run.id)
  if (
    !mission ||
    TERMINAL_MISSION_STATUSES.has(mission.status) ||
    currentBatch?.status !== 'TESTING' ||
    currentBatch.missionId !== effect.missionId ||
    currentBatch.mergeCommit !== batch.mergeCommit ||
    currentBatch.baseCommit !== batch.baseCommit ||
    currentBatch.candidateIds[0] !== effect.payload.candidateId ||
    task?.stage !== 'INTEGRATION_READY' ||
    task.missionId !== batch.missionId ||
    candidate?.status !== 'ACTIVE' ||
    candidate.taskId !== task.taskId ||
    candidate.missionId !== batch.missionId ||
    (run &&
      (currentRun?.status !== 'RUNNING' ||
        currentRun.runtimeEpoch !== run.runtimeEpoch ||
        currentRun.claimCount !== run.claimCount))
  ) {
    throw new RegressionInterrupted('interrupted')
  }
}

type CancellationReason =
  | 'request_stale'
  | 'regression_retried'
  | 'regression_interrupted'
  | 'integration_unavailable'
export function cancelIntegrationRegression(
  store: AxiomStore,
  batch: IntegrationBatch,
  run: VerificationRun,
  reason: CancellationReason
): void {
  if (
    (run.status === 'QUEUED' || run.status === 'RUNNING') &&
    store.updateVerificationRun({
      ...regressionFence(run),
      expectedStatus: run.status,
      status: 'CANCELED',
      finishedAt: new Date().toISOString()
    })
  ) {
    auditIntegration(store, batch, 'integration.regression_canceled', {
      status: batch.status,
      runId: run.id,
      reason
    })
  }
}

export function cancelIntegrationRegressions(
  store: AxiomStore,
  batch: IntegrationBatch,
  reason: CancellationReason
): void {
  for (const run of store.listVerificationRuns({ missionId: batch.missionId, batchId: batch.id })) {
    cancelIntegrationRegression(store, batch, run, reason)
  }
}

export function startIntegrationRegression(input: {
  store: AxiomStore
  batch: IntegrationBatch
  effect: ApplyEffect
  commands: string[]
  baseline: Record<string, string | null>
  startedAt: string
  assertCurrent: () => void
}): VerificationRun {
  const { store, batch, effect, commands, baseline, startedAt, assertCurrent } = input
  return store.transaction('integration_regression_started', () => {
    assertCurrent()
    cancelIntegrationRegressions(store, batch, 'regression_retried')
    const inserted = store.insertVerificationRun({
      id: `vrun_${randomUUID()}`,
      missionId: batch.missionId,
      batchId: batch.id,
      taskId: effect.payload.taskId,
      candidateId: effect.payload.candidateId,
      status: 'QUEUED',
      verifier: 'IntegrationController',
      commands: [],
      toolVersions: {},
      verdictDetail: {}
    })
    if (!effect.leaseEpoch) {
      throw new Error('regression_unavailable')
    }
    const run = store.claimVerificationRun({
      id: inserted.id,
      runtimeEpoch: effect.leaseEpoch,
      startedAt,
      verifier: 'IntegrationController'
    })
    if (
      !run ||
      !store.updateVerificationRun({
        ...regressionFence(run),
        commands,
        verdictDetail: { phase: 'checking', baseline }
      })
    ) {
      throw new Error('regression_unavailable')
    }
    auditIntegration(store, batch, 'integration.regression_started', {
      status: batch.status,
      runId: run.id,
      mergeCommit: batch.mergeCommit!,
      commandCount: commands.length
    })
    return run
  })
}

export function settleIntegrationRegression(
  deps: IntegrationDependencies,
  input: {
    batch: IntegrationBatch
    run: VerificationRun
    verdict: VerificationVerdict
    commands: string[]
    toolVersions: Record<string, string>
    verdictDetail: Record<string, unknown>
    finishedAt: string
    assertCurrent: () => void
  }
): void {
  const { store } = deps
  const { batch, run, verdict, commands, toolVersions, verdictDetail, finishedAt, assertCurrent } =
    input
  store.transaction('integration_regression_verdict', () => {
    assertCurrent()
    if (
      !store.updateVerificationRun({
        ...regressionFence(run),
        status: verdict.verdict,
        finishedAt,
        commands,
        toolVersions,
        verdictDetail
      })
    ) {
      throw new RegressionInterrupted('interrupted')
    }
    if (verdict.verdict === 'INCONCLUSIVE') {
      auditIntegration(store, batch, 'integration.regression_inconclusive', {
        status: 'TESTING',
        runId: run.id,
        reason: verdict.reason
      })
      return
    }
    const status = verdict.verdict === 'PASS' ? 'PROMOTABLE' : 'FAILED'
    if (!store.transitionIntegrationBatch({ id: batch.id, expectedStatus: 'TESTING', status })) {
      throw new RegressionInterrupted('interrupted')
    }
    if (verdict.verdict === 'PASS') {
      auditIntegration(store, batch, 'integration.batch_promotable', {
        status,
        runId: run.id,
        mergeCommit: batch.mergeCommit!
      })
    } else {
      settleIntegrationConflict(deps, run, 'integration_regression_failed')
      auditIntegration(store, batch, 'integration.batch_failed', {
        status,
        runId: run.id,
        reason: verdict.reason
      })
    }
  })
}
