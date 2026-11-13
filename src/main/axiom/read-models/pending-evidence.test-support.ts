import { expect } from 'vitest'
import { z } from 'zod'
import type { VerificationRunStatus } from '../../../shared/axiom-contract/lifecycle'
import { emptyTokenUsage } from '../../../shared/axiom-contract/token-usage'
import { humanAcceptance } from '../verification/human-review-fixture.test-support'
import { recordedAt, type PendingFixture, type PendingItem } from './pending-fixture.test-support'

export function binding(f: PendingFixture, id: string) {
  const task = f.task(id)
  const seq = f.store.nextAttemptSeq(task.taskId)
  const { dispatch } = f.db.createStartingWorkerDispatch({
    taskId: task.taskId,
    creator: { kind: 'system' },
    maxDepth: 1,
    startOptions: { topology: 'current', agent: 'codex' }
  })
  f.store.insertAttemptBinding({
    taskId: task.taskId,
    missionId: f.missionId,
    seq,
    branch: `axiom/attempt/${task.taskId}/${seq}`,
    dispatchId: dispatch.id,
    agentSpecId: 'fixture-spec',
    contextPackageId: 'fixture-context'
  })
  return { taskId: task.taskId, seq, attemptId: dispatch.id }
}

export function verification(
  f: PendingFixture,
  id: string,
  status: VerificationRunStatus,
  reason: unknown = 'acceptance_human'
) {
  const attempt = binding(f, id)
  f.stage(id, 'VERIFYING')
  const candidate = f.store.insertCandidate({
    id: `candidate-${attempt.attemptId}`,
    taskId: attempt.taskId,
    missionId: f.missionId,
    attemptId: attempt.attemptId,
    commitSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    status: 'ACTIVE',
    supersededBy: null
  })
  return f.store.insertVerificationRun({
    id: `run-${attempt.attemptId}`,
    taskId: attempt.taskId,
    missionId: f.missionId,
    candidateId: candidate.id,
    status,
    verdictDetail: { verdict: 'INCONCLUSIVE', reason, acceptance: humanAcceptance },
    commands: [],
    toolVersions: {},
    verifier: 'FixtureVerifier'
  })
}

export function tokenBudget(f: PendingFixture, id: string, limit = 100, used = 100) {
  const task = f.task(id)
  const attempt = binding(f, id)
  f.store.updateTaskSpec({
    taskId: task.taskId,
    expectedStage: task.stage,
    retryPolicy: task.retryPolicy,
    spec: { ...task.spec, budget: { maxTokens: limit } }
  })
  f.store.upsertAttemptTokenUsage({
    ...emptyTokenUsage('complete'),
    ...attempt,
    missionId: f.missionId,
    provider: 'codex',
    newTokens: used,
    inputTokens: used,
    final: true,
    measuredAt: recordedAt
  })
  return attempt
}

export function approval(f: PendingFixture) {
  f.db.db
    .prepare(`INSERT INTO approvals
    (id, mission_id, action_kind, inputs_hash, risk, status, expires_at, requested_by)
    VALUES ('pending-approval', ?, 'budget_increase', 'hash', 'high', 'PENDING', '2099-01-01', 'fixture')`)
    .run(f.missionId)
}

export function backoff(f: PendingFixture, id: string) {
  const attempt = binding(f, id)
  const dueAt = '2099-01-01T00:00:00.000Z'
  f.store.transaction('pending_backoff', () =>
    f.store.enqueueEffect({
      missionId: f.missionId,
      kind: 'attempt.continue',
      key: `${attempt.taskId}/${attempt.seq}`,
      dueAt,
      payload: { taskId: attempt.taskId, seq: attempt.seq, chain: 1, failureClass: 'usage_limit' }
    })
  )
  return dueAt
}

export function proposal(f: PendingFixture) {
  return f.store.insertSupervisionProposal({
    id: 'pending-supervision',
    rule: 'stalled',
    fromMode: 'observe',
    toMode: 'notify',
    sinceSequence: 0,
    throughSequence: 10,
    evidence: {
      hits: 10,
      falsePositives: 0,
      known: 10,
      inconclusive: 0,
      hitRate: 1,
      savedMs: 1000,
      sinceSequence: 0,
      throughSequence: 10
    }
  })
}

export function stall(f: PendingFixture, id: string) {
  const attempt = binding(f, id)
  f.stage(id, 'RUNNING')
  f.audit('attempt', attempt.attemptId, 'attempt.supervised', {
    taskId: attempt.taskId,
    seq: attempt.seq,
    rule: 'stalled',
    mode: 'notify',
    thresholdMs: 60_000,
    thresholdSource: 'default',
    idleMs: 120_000,
    lastEventAt: '2026-11-01T11:58:00.000Z',
    wouldActAt: '2026-11-01T11:59:00.000Z'
  })
  return attempt
}

export function item(items: PendingItem[], kind: PendingItem['kind'], objectId?: string) {
  const found = items.find(
    (entry) => entry.kind === kind && (objectId === undefined || entry.objectId === objectId)
  )
  expect(found).toBeDefined()
  if (!found) {
    throw new Error(`Missing ${kind} item`)
  }
  return found
}

export async function act(f: PendingFixture, entry: PendingItem, method: string, params: unknown) {
  const offered = entry.actions.find((action) => action === method)
  expect(offered).toBeDefined()
  if (!offered) {
    throw new Error(`Missing ${method} action`)
  }
  const response = await f.call(offered, params)
  expect(response).toMatchObject({ ok: true })
  return response
}

export function databaseSnapshot(f: PendingFixture) {
  const tables = z
    .array(z.object({ name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/) }))
    .parse(
      f.db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    )
  return tables.map(({ name }) => ({
    name,
    rows: f.db.db
      .prepare(`SELECT * FROM "${name}"`)
      .all()
      .map((row) => JSON.stringify(row))
      .sort()
  }))
}
