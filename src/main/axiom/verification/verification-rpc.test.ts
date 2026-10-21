import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { rpcFixture, createParams } from '../rpc-fixture.test-support'
import {
  VerificationListResponseSchema,
  VerificationResponseSchema
} from '../../../shared/axiom-contract/verification-params'

let f: ReturnType<typeof rpcFixture>
let missionId: string
beforeEach(async () => {
  f = rpcFixture()
  await f.call('axiom.mission.create', createParams)
  missionId = f.store.listMissions({})[0].id
  for (const id of ['one', 'two']) {
    f.store.insertCandidate({
      id: `candidate-${id}`,
      missionId,
      taskId: `task-${id}`,
      attemptId: `attempt-${id}`,
      commitSha: (id === 'one' ? 'a' : 'c').repeat(40),
      treeSha: 'b'.repeat(40),
      status: 'ACTIVE',
      supersededBy: null
    })
    f.store.insertVerificationRun({
      id,
      missionId,
      taskId: `task-${id}`,
      candidateId: `candidate-${id}`,
      status: 'QUEUED',
      verdictDetail: {},
      commands: [],
      toolVersions: {},
      verifier: 'VerificationService'
    })
  }
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

it('shows every persisted field plus real Candidate hashes and phase without mutating state', async () => {
  const before = f.store.listVerificationRuns({ missionId })
  const result = await f.call(
    'axiom.verification.show',
    { runId: 'one' },
    { orchestrationContractVersion: undefined, orchestrationRequestId: undefined }
  )
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.code)
  }
  expect(VerificationResponseSchema.parse(result.result).run).toEqual({
    ...f.store.getVerificationRun('one'),
    candidateCommitSha: 'a'.repeat(40),
    candidateTreeSha: 'b'.repeat(40),
    phase: null
  })
  expect(f.store.listVerificationRuns({ missionId })).toEqual(before)
})

it('combines Mission, Task, Candidate and status filters and projects a phase', async () => {
  f.store.claimVerificationRun({ id: 'one', runtimeEpoch: 'epoch', startedAt: 'now' })
  const response = await f.call('axiom.verification.list', {
    missionId,
    taskId: 'task-one',
    candidateId: 'candidate-one',
    status: 'RUNNING'
  })
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  expect(VerificationListResponseSchema.parse(response.result).runs).toMatchObject([
    { id: 'one', phase: 'claimed', claimCount: 1 }
  ])
  const empty = await f.call('axiom.verification.list', {
    missionId,
    taskId: 'task-two',
    status: 'RUNNING'
  })
  expect(empty).toMatchObject({ ok: true, result: { runs: [] } })
  expect(await f.call('axiom.verification.list', { missionId, status: 'INVALID' })).toMatchObject({
    ok: false
  })
})

it('rejects unknown runs and missing Candidates instead of inventing hashes', async () => {
  expect(await f.call('axiom.verification.show', { runId: 'absent' })).toMatchObject({
    ok: false,
    error: { code: 'not_found' }
  })
  f.db.db.prepare('DELETE FROM candidates WHERE id = ?').run('candidate-one')
  expect(await f.call('axiom.verification.show', { runId: 'one' })).toMatchObject({
    ok: false,
    error: { code: 'not_found' }
  })
  expect(await f.call('axiom.verification.list', { missionId })).toMatchObject({
    ok: false,
    error: { code: 'not_found' }
  })
})
