import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { PtyLivenessVerdict } from '../../../shared/pty-liveness-verdict'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { MissionController } from '../mission-controller/mission-controller'

export type RecoveryContext = {
  db: OrchestrationDb
  store: AxiomStore
  missions: MissionController
  runtime: OrcaRuntimeService
  artifacts: ArtifactStore
  now: () => number
}
export type AttemptBinding = NonNullable<ReturnType<AxiomStore['getAttemptBinding']>>

// Kernel mutations commit independently; replay only writes a new audit when its result changed.
export function auditAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  event: string,
  after: Record<string, AuditEvent['after']>
): boolean {
  const objectId = binding.dispatchId ?? `${binding.taskId}/${binding.seq}`
  const value = { taskId: binding.taskId, seq: binding.seq, ...after }
  const previous = z
    .object({ after: z.string().nullable() })
    .optional()
    .parse(
      ctx.db.db
        .prepare(
          `SELECT after FROM audit_events WHERE mission_id = ? AND object_kind = 'attempt'
     AND object_id = ? AND event = ? ORDER BY sequence DESC LIMIT 1`
        )
        .get(binding.missionId, objectId, event)
    )
  if (previous?.after === JSON.stringify(value)) {
    return false
  }
  ctx.store.appendAuditEvent({
    missionId: binding.missionId,
    actor: 'RecoveryService',
    objectKind: 'attempt',
    objectId,
    event,
    before: null,
    after: value,
    createdAt: new Date(ctx.now()).toISOString()
  })
  return true
}

export function observeAttemptLiveness(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  verdict: PtyLivenessVerdict
): number {
  const dispatchId = binding.dispatchId!
  return ctx.store.transaction('attempt_liveness', () => {
    const facts = ctx.db.getAttemptObservationFacts(dispatchId)
    const latest = facts.findLast((fact) => fact.facet === 'liveness')
    if (latest?.facet === 'liveness' && latest.payload.status === verdict.status) {
      return latest.homeReceivedAt
    }
    // Initial live observations need no persistence; only uncertainty and its recovery change the clock.
    if (verdict.status === 'live' && latest?.facet !== 'liveness') {
      return ctx.now()
    }
    const since = ctx.now()
    ctx.db.recordAttemptObservation({
      id: `liveness_${randomUUID()}`,
      dispatchId,
      sequence: (facts.at(-1)?.sequence ?? -1) + 1,
      authorityId: 'axiom-control-plane',
      authorityClock: 'home',
      facet: 'liveness',
      payload: verdict,
      sourceObservedAt: null,
      executionReceivedAt: null,
      homeReceivedAt: since
    })
    if (verdict.status === 'unverifiable') {
      auditAttempt(ctx, binding, 'attempt.unverifiable', { reason: verdict.reason, since })
    }
    return since
  })
}

export async function abandonmentEvidence(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  liveness: PtyLivenessVerdict,
  since: number,
  toleranceMinutes: number
) {
  const dispatchId = binding.dispatchId!
  const worker = ctx.db.getWorkerDispatch(dispatchId)
  return ctx.artifacts.put({
    missionId: binding.missionId,
    kind: 'evidence',
    mediaType: 'application/json',
    related: [binding.taskId, dispatchId],
    createdBy: 'RecoveryService',
    content: Buffer.from(
      JSON.stringify({
        taskId: binding.taskId,
        attemptId: dispatchId,
        seq: binding.seq,
        branch: binding.branch,
        worktreeId: worker?.worktree_id ?? null,
        workerState: worker?.state ?? null,
        dispatchStatus: ctx.db.getDispatchContextById(dispatchId)?.status,
        liveness,
        since,
        abandonedAt: ctx.now(),
        toleranceMinutes,
        observationFacts: ctx.db.getAttemptObservationFacts(dispatchId)
      })
    )
  })
}

export function retainSubmission(
  ctx: RecoveryContext,
  binding: AttemptBinding
): string | undefined {
  const dispatchId = binding.dispatchId!
  const submission = ctx.store.getSubmissionByDispatch(dispatchId)
  if (
    !submission ||
    ctx.db.getWorkerTerminalResourceByOwner(dispatchId)?.release_state !== 'not_requested'
  ) {
    return
  }
  let retainDisposition:
    | ReturnType<OrchestrationDb['retainWorkerTerminalResource']>['disposition']
    | undefined
  try {
    retainDisposition = ctx.db.retainWorkerTerminalResource(dispatchId).disposition
  } catch {
    // Match submission settlement: never roll back the Candidate or expose raw kernel errors.
  }
  const action = retainDisposition ? 'terminal_retained' : 'terminal_retain_failed'
  const changed = ctx.store.transaction('recovery_retain', () =>
    auditAttempt(
      ctx,
      binding,
      retainDisposition ? 'attempt.terminal_retained' : 'attempt.terminal_retain_failed',
      {
        submissionId: submission.id,
        candidateId: submission.candidateId,
        ...(retainDisposition ? { retainDisposition } : {})
      }
    )
  )
  return changed ? action : undefined
}
