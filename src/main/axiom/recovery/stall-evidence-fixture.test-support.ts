import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { vi } from 'vitest'
import { rpcFixture } from '../rpc-fixture.test-support'
import { planned } from '../mission-controller/controller-fixture.test-support'
import { MissionController } from '../mission-controller/mission-controller'
import { ArtifactStore } from '../artifacts/artifact-store'
import { report } from '../execution/submission-fixture.test-support'
import { RecoveryService } from './recovery-service'
import * as observation from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { VerificationRunStatus } from '../../../shared/axiom-contract/lifecycle'

export const evidenceNow = Date.parse('2026-11-12T12:00:00.000Z')

export function stallEvidenceFixture() {
  const rpc = rpcFixture()
  const missions = new MissionController(rpc.db, rpc.store)
  const f = planned({ ...rpc, controller: missions })
  const task = f.store.listTaskStages({ missionId: f.missionId })[0]
  if (!task) {
    throw new Error('Missing evidence fixture Task')
  }
  vi.spyOn(observation, 'inspectWorkerTerminal').mockResolvedValue({
    terminal: null,
    terminalHandle: null,
    exact: false,
    status: 'unverifiable'
  })
  let now = evidenceNow
  const recovery = new RecoveryService(f.db, f.store, missions, {
    runtime: rpc.runtime,
    artifacts: new ArtifactStore(f.store, '/tmp/axiom-stall-unused'),
    now: () => now
  })
  function audit(attemptId: string, event: string, after: AuditEvent['after'], createdAt?: string) {
    return f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'fixture',
      objectKind: 'attempt',
      objectId: attemptId,
      event,
      before: null,
      after,
      createdAt: createdAt ?? new Date(now).toISOString()
    })
  }
  function observe(mode: 'observe' | 'notify' = 'observe') {
    const seq = f.store.nextAttemptSeq(task.taskId)
    const attemptId = `stall-attempt-${seq}`
    f.store.insertAttemptBinding({
      taskId: task.taskId,
      missionId: f.missionId,
      seq,
      dispatchId: attemptId,
      branch: `axiom/attempt/${task.taskId}/${seq}`,
      agentSpecId: 'fixture',
      contextPackageId: 'fixture'
    })
    const sequence = audit(attemptId, 'attempt.supervised', {
      taskId: task.taskId,
      seq,
      rule: 'stalled',
      mode,
      thresholdMs: 60_000,
      thresholdSource: 'default',
      idleMs: 120_000,
      lastEventAt: new Date(now - 180_000).toISOString(),
      wouldActAt: new Date(now - 120_000).toISOString()
    })
    return { attemptId, sequence, seq }
  }
  function verification(attemptId: string, status: VerificationRunStatus) {
    return f.store.insertVerificationRun({
      id: randomUUID(),
      missionId: f.missionId,
      taskId: task.taskId,
      candidateId: `candidate-${attemptId}`,
      status,
      verdictDetail: {},
      commands: [],
      toolVersions: {},
      verifier: 'fixture'
    })
  }
  function submit(attemptId: string, statuses: VerificationRunStatus[] = []) {
    const candidateId = `candidate-${attemptId}`
    f.store.insertCandidate({
      id: candidateId,
      missionId: f.missionId,
      taskId: task.taskId,
      attemptId,
      commitSha: randomUUID().replaceAll('-', '').padEnd(40, '0'),
      treeSha: 'b'.repeat(40),
      status: 'ACTIVE',
      supersededBy: null
    })
    const submission = f.store.insertSubmission({
      id: `submission-${attemptId}`,
      missionId: f.missionId,
      taskId: task.taskId,
      attemptId,
      candidateId,
      report
    })
    for (const status of statuses) {
      verification(attemptId, status)
    }
    return submission
  }
  function samples(hits: number, falsePositives = 0, inconclusive = 0) {
    for (let i = 0; i < hits + falsePositives + inconclusive; i++) {
      const row = observe()
      if (i < hits) {
        audit(row.attemptId, 'attempt.stopped', { reason: 'timeout' })
      } else if (i < hits + falsePositives) {
        submit(row.attemptId, ['PASS'])
      } else {
        audit(row.attemptId, 'attempt.failed', {
          reason: 'provider',
          settlement: { kind: 'interrupted' }
        })
      }
    }
  }
  const audits = () => f.store.listAuditEvents({ missionId: f.missionId })
  return {
    ...f,
    ...rpc,
    task,
    recovery,
    observe,
    audit,
    submit,
    verification,
    samples,
    audits,
    setNow: (value: number) => {
      now = value
    },
    tick: () => recovery.reconcileAttempts(),
    reconciled: () => audits().filter((row) => row.event === 'attempt.supervision_reconciled'),
    proposals: () =>
      z
        .array(
          z.object({
            id: z.string(),
            rule: z.string(),
            status: z.string(),
            from_mode: z.string(),
            to_mode: z.string(),
            since_sequence: z.number(),
            through_sequence: z.number(),
            evidence: z.string(),
            resolver: z.string().nullable(),
            created_at: z.string(),
            resolved_at: z.string().nullable()
          })
        )
        .parse(f.db.db.prepare('SELECT * FROM supervision_proposals ORDER BY rowid').all()),
    show: () => rpc.call('axiom.supervision.show', {}),
    update: (mode: string, missionId?: string) =>
      rpc.call('axiom.supervision.update', { rule: 'stalled', mode, missionId }),
    resolve: (proposalId: string, resolution: 'accept' | 'dismiss') =>
      rpc.call('axiom.supervision.resolve', { proposalId, resolution }),
    cleanup: () => {
      vi.restoreAllMocks()
      f.db.close()
    }
  }
}

export function recordStallEvidence(name: string, value: unknown) {
  const directory = process.env.AXIOM_STALL_EVIDENCE_DIRECTORY
  if (directory) {
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2))
  }
}
