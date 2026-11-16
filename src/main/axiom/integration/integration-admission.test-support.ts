import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, vi } from 'vitest'
import type { TaskStage } from '../../../shared/axiom-contract/lifecycle'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import { verificationFixture } from '../verification/verification-fixture.test-support'
import { EffectOutbox } from '../outbox/effect-outbox'

type Fixture = Pick<
  ReturnType<typeof verificationFixture>,
  'db' | 'store' | 'controller' | 'missionId' | 'candidate' | 'task'
>

export function admissionFixtures() {
  const fixtures: (Fixture & { root: string; effects: EffectOutbox })[] = []
  afterEach(async () => {
    for (const f of fixtures.splice(0)) {
      await f.effects.stop()
      f.db.close()
      await rm(f.root, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
  return async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'axiom-admission-'))
    const f = verificationFixture(root)
    const effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'admission' })
    const result = { ...f, root, effects }
    fixtures.push(result)
    return result
  }
}

export function taskBySpec(f: Fixture, id: string) {
  const task = f.store.listTaskStages({ missionId: f.missionId }).find((t) => t.spec.id === id)
  if (!task) {
    throw new Error(`Missing fixture Task ${id}`)
  }
  return task
}

export function recordStage(f: Fixture, taskId: string, to: TaskStage) {
  const task = f.store.getTaskStage(taskId)!
  f.store.transaction('fixture_stage', () => {
    f.store.updateTaskStage({ taskId, from: task.stage, to })
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'test',
      objectKind: 'task',
      objectId: taskId,
      event: 'task.stage',
      before: { stage: task.stage },
      after: { stage: to }
    })
  })
}

export function verifyTask(
  f: Fixture,
  taskId = f.task.taskId,
  status: VerificationRun['status'] | null = 'PASS',
  batchId?: string
) {
  const candidate =
    f.store.listCandidates(f.missionId).find((c) => c.taskId === taskId) ??
    f.store.insertCandidate({
      ...f.candidate,
      id: `candidate-${taskId}`,
      taskId,
      attemptId: `dispatch-${taskId}`
    })
  const run = status
    ? f.store.insertVerificationRun({
        id: `run-${taskId}-${status}`,
        missionId: f.missionId,
        taskId,
        candidateId: candidate.id,
        status,
        verdictDetail: {},
        commands: [],
        toolVersions: {},
        verifier: 'VerificationService',
        ...(batchId ? { batchId } : {})
      })
    : undefined
  recordStage(f, taskId, 'VERIFIED')
  return { taskId, candidate, run }
}

export function requestEvents(f: Fixture) {
  return f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((event) => event.event === 'integration.requested')
}

export function requestState(f: Fixture & { effects: EffectOutbox }) {
  return {
    tasks: f.store.listTaskStages({ missionId: f.missionId }),
    effects: f.store.listEffects({ missionId: f.missionId }),
    audits: f.store.listAuditEvents({ missionId: f.missionId })
  }
}
