import type { FinalizationOutcome } from '../../../shared/axiom-contract/mission-finalization'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { EffectOutbox } from '../outbox/effect-outbox'
import { readIntegrationHead, type IntegrationRuntime } from '../integration/integration-scratch'
import { integrationRepository, recordedIntegrationHead } from '../integration/integration-head'
import { readIntegrationGit } from '../integration/integration-merge'
import { finalizationEntry } from '../read-models/finalization-reads'
import { completionGate } from './completion-gate'
import { recordFinalization } from './finalization-record'
import type { ArtifactStore } from '../artifacts/artifact-store'
import {
  COMPLETION_REPORT_MEDIA_TYPE,
  completionReportText
} from '../../../shared/axiom-contract/completion-report'
import { buildCompletionReport } from './completion-report'

type FinalizationDependencies = {
  db: OrchestrationDb
  store: AxiomStore
  missions: MissionController
  runtime: IntegrationRuntime
  artifacts: ArtifactStore
}

function exitedOne(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 1
}

export async function executeFinalization(deps: FinalizationDependencies, missionId: string) {
  const { store, missions, runtime, db } = deps
  const mission = store.getMission(missionId)
  if (mission?.status !== 'FINALIZING') {
    return 'done' as const
  }
  const entry = finalizationEntry(store, missionId)
  const record = (outcome: FinalizationOutcome) =>
    recordFinalization(store, db, missions, missionId, outcome, entry)
  const integrationHead = await readIntegrationHead(runtime, mission)
  const heads = { targetBranch: mission.targetBranch, integrationHead }
  if (recordedIntegrationHead(store, missionId) !== integrationHead) {
    record({ ...heads, outcome: 'stopped', reason: 'integration_head_unexpected' })
    return 'done' as const
  }
  const cwd = await integrationRepository(runtime, mission)
  let targetHead: string
  try {
    targetHead = (
      await readIntegrationGit(
        cwd,
        ['rev-parse', '--verify', '--quiet', `refs/heads/${mission.targetBranch}^{commit}`],
        true
      )
    ).trim()
  } catch (error) {
    if (!exitedOne(error)) {
      throw error
    }
    record({ ...heads, outcome: 'stopped', reason: 'target_branch_not_found' })
    return 'done' as const
  }
  try {
    await readIntegrationGit(
      cwd,
      ['merge-base', '--is-ancestor', targetHead, integrationHead],
      true
    )
  } catch (error) {
    if (!exitedOne(error)) {
      throw error
    }
    record({ ...heads, targetHead, outcome: 'stopped', reason: 'target_branch_moved' })
    return 'done' as const
  }
  const facts = {
    integrationHead,
    targetHead,
    targetContained: true
  }
  const gate = completionGate(store, db, missionId, facts)
  if (gate.every((item) => item.pass)) {
    const report = buildCompletionReport(store, db, missionId, facts)
    const artifact = await deps.artifacts.put({
      missionId,
      kind: 'completion_report',
      mediaType: COMPLETION_REPORT_MEDIA_TYPE,
      related: [missionId],
      createdBy: 'MissionController',
      content: Buffer.from(completionReportText(report), 'utf8')
    })
    record({
      ...heads,
      targetHead,
      gate,
      outcome: 'ready',
      reportArtifactId: artifact.id,
      reportSha256: artifact.sha256
    })
  } else {
    record({ ...heads, targetHead, gate, outcome: 'stopped', reason: 'completion_gate_failed' })
  }
  return 'done' as const
}

export function registerMissionFinalize(
  deps: FinalizationDependencies & { effects: EffectOutbox }
): void {
  deps.effects.register('mission.finalize', {
    execute: (effect) => executeFinalization(deps, effect.missionId),
    maxAttempts: 3,
    backoffMs: [1000, 5000],
    onOrphan: () => 'retry',
    onExhausted: (effect) => {
      const mission = deps.store.getMission(effect.missionId)
      if (mission?.status === 'FINALIZING') {
        recordFinalization(deps.store, deps.db, deps.missions, mission.id, {
          targetBranch: mission.targetBranch,
          outcome: 'stopped',
          reason: 'finalization_unavailable'
        })
      }
    }
  })
}
