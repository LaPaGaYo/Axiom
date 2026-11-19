import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import type { AxiomStore } from '../db/axiom-store'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { ArtifactStore } from '../artifacts/artifact-store'
import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

export function reportArtifacts(store: AxiomStore) {
  const root = mkdtempSync(path.join(tmpdir(), 'axiom-completion-report-'))
  roots.push(root)
  return new ArtifactStore(store, root)
}

export function reportAttempt(
  store: AxiomStore,
  task: TaskStageRecord,
  seq = 1,
  dispatchId?: string
) {
  const contextPackageId = `context-${task.taskId}-${seq}`
  const { id: agentSpecId } = store.insertAgentSpec({
    version: 1,
    missionId: task.missionId,
    taskId: task.taskId,
    role: 'worker',
    contextPackageId,
    provider: 'codex',
    model: 'fixture-model',
    endpointProfile: 'subscription',
    reasoning: { effort: 'high' },
    permissions: { write: ['src'], network: 'restricted', tools: ['shell', 'git-readonly'] },
    budget: { maxRuntimeMinutes: 10 },
    submissionContract: 'axiom-submission-v1',
    acceptanceCriteria: task.spec.acceptanceCriteria,
    capabilities: ['coding'],
    workspace: { strategy: 'attempt-worktree' },
    selection: {
      installed: ['codex'],
      filtered: [],
      ranked: ['codex'],
      chosen: 'codex',
      rationale: 'fixture'
    }
  })
  const binding = {
    missionId: task.missionId,
    taskId: task.taskId,
    seq,
    branch: `axiom/attempt/${task.taskId}/${seq}`,
    dispatchId:
      dispatchId ?? (seq === 1 ? `attempt-${task.taskId}` : `attempt-${task.taskId}-${seq}`),
    agentSpecId,
    contextPackageId
  }
  store.insertAttemptBinding(binding)
  return binding
}

export function reportSubmission(store: AxiomStore, task: TaskStageRecord) {
  return store.insertSubmission({
    id: `submission-${task.taskId}`,
    missionId: task.missionId,
    taskId: task.taskId,
    attemptId: `attempt-${task.taskId}`,
    candidateId: `candidate-${task.taskId}`,
    report: {
      summary: 'Implemented the criterion',
      filesChanged: ['src/feature.ts'],
      checksRun: [{ command: 'pnpm test', result: 'pass' }],
      artifacts: [],
      limitations: ['Local fixture only'],
      risks: ['External behavior untested'],
      questions: [],
      followUps: ['Exercise another repository']
    }
  })
}

export function blockingReportApproval(db: OrchestrationDb, missionId: string) {
  db.db
    .prepare(`INSERT INTO approvals
    (id, mission_id, action_kind, inputs_hash, risk, status, expires_at, requested_by)
    VALUES ('report-approval', ?, 'budget_increase', 'hash', 'high', 'PENDING', '2099-01-01', 'fixture')`)
    .run(missionId)
}
