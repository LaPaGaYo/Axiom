import { afterAll, afterEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from './axiom-store'
import { verificationRunsStore } from './verification-runs-store'
import {
  VERIFICATION_RUN_STATUSES,
  isLegalVerificationRunTransition
} from '../../../shared/axiom-contract/lifecycle'

const db = new OrchestrationDb(':memory:')
const store = new AxiomStore(db)
afterAll(() => db.close())
afterEach(() => db.db.prepare('DELETE FROM verification_runs').run())
const legal = {
  QUEUED: ['RUNNING', 'CANCELED'],
  RUNNING: ['PASS', 'FAIL', 'INCONCLUSIVE', 'QUEUED', 'CANCELED'],
  INCONCLUSIVE: ['SPECIALIST_REVIEW', 'HUMAN_REVIEW', 'CANCELED'],
  SPECIALIST_REVIEW: ['PASS', 'FAIL', 'HUMAN_REVIEW', 'CANCELED'],
  HUMAN_REVIEW: ['PASS', 'FAIL', 'CANCELED'],
  PASS: [],
  FAIL: [],
  CANCELED: []
}
it('guards every legal and illegal transition, including irreversible FAIL', () => {
  for (const from of VERIFICATION_RUN_STATUSES) {
    for (const to of VERIFICATION_RUN_STATUSES) {
      const allowed = legal[from].some((value) => value === to)
      expect(isLegalVerificationRunTransition(from, to)).toBe(allowed)
      const id = `${from}-${to}`
      const before = store.insertVerificationRun({
        id,
        missionId: 'm',
        taskId: 't',
        candidateId: 'c',
        status: from,
        verdictDetail: {},
        commands: [],
        toolVersions: {},
        verifier: 'VerificationService'
      })
      expect(store.updateVerificationRun({ id, expectedStatus: from, status: to })).toBe(allowed)
      if (!allowed) {
        expect(store.getVerificationRun(id)).toEqual(before)
      } else {
        expect(store.getVerificationRun(id)?.status).toBe(to)
      }
    }
  }
})
it('writes commands and versions only under the exact claim fence', () => {
  store.insertVerificationRun({
    id: 'v',
    missionId: 'm',
    taskId: 't',
    candidateId: 'c',
    status: 'QUEUED',
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'VerificationService'
  })
  store.claimVerificationRun({ id: 'v', runtimeEpoch: 'epoch', startedAt: 'now' })
  const fence = {
    id: 'v',
    expectedStatus: 'RUNNING' as const,
    expectedRuntimeEpoch: 'epoch',
    expectedClaimCount: 1
  }
  const fields = { commands: ['node --version'], toolVersions: { node: 'v22' } }
  expect(store.updateVerificationRun({ ...fence, ...fields, expectedClaimCount: 2 })).toBe(false)
  expect(store.getVerificationRun('v')?.commands).toEqual([])
  expect(store.updateVerificationRun({ ...fence, ...fields })).toBe(true)
  expect(store.getVerificationRun('v')).toMatchObject(fields)
})

it('stores the batch of a verification run and leaves a candidate run without the key', () => {
  const runs = verificationRunsStore(db)
  const input = {
    missionId: 'm',
    taskId: 't',
    candidateId: 'c',
    status: 'QUEUED' as const,
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'IntegrationController'
  }
  const batch = runs.insertVerificationRun({ ...input, id: 'batch-run', batchId: 'batch' })
  expect(runs.getVerificationRun(batch.id)?.batchId).toBe('batch')
  expect(runs.listVerificationRunsByStatus('QUEUED')).toEqual([batch])
  expect(runs.listVerificationRuns({ missionId: 'm', batchId: 'batch' })).toEqual([batch])
  expect(
    db.db.prepare('SELECT batch_id FROM verification_runs WHERE id = ?').get(batch.id)
  ).toEqual({ batch_id: 'batch' })

  runs.insertVerificationRun({ ...input, id: 'candidate-run', verifier: 'VerificationService' })
  const candidate = runs.getVerificationRun('candidate-run')
  expect(candidate && 'batchId' in candidate).toBe(false)
  expect(
    db.db.prepare('SELECT batch_id FROM verification_runs WHERE id = ?').get('candidate-run')
  ).toEqual({ batch_id: null })
  expect(
    runs.updateVerificationRun({ id: batch.id, expectedStatus: 'QUEUED', status: 'RUNNING' })
  ).toBe(true)
  expect(runs.getVerificationRun(batch.id)?.batchId).toBe('batch')

  runs.insertVerificationRun({ ...input, id: 'claimed-batch-run', batchId: 'second-batch' })
  expect(
    runs.claimVerificationRun({ id: 'claimed-batch-run', runtimeEpoch: 'epoch', startedAt: 'now' })
  ).toMatchObject({ status: 'RUNNING', batchId: 'second-batch', claimCount: 1 })
  expect(runs.getVerificationRun('claimed-batch-run')?.batchId).toBe('second-batch')

  const before = runs.listVerificationRuns({ missionId: 'm' })
  expect(() =>
    runs.insertVerificationRun({ ...input, id: 'invalid-batch-run', batchId: '' })
  ).toThrow()
  expect(runs.listVerificationRuns({ missionId: 'm' })).toEqual(before)
  expect(db.db.prepare('SELECT COUNT(*) AS count FROM verification_runs').get()).toEqual({
    count: 3
  })
})

it('claims a run under the verifier it is given and under VerificationService by default', () => {
  const input = {
    missionId: 'm',
    taskId: 't',
    candidateId: 'c',
    status: 'QUEUED' as const,
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'IntegrationController'
  }
  for (const id of ['explicit', 'default', 'empty']) {
    store.insertVerificationRun({ ...input, id })
  }
  store.claimVerificationRun({
    id: 'explicit',
    runtimeEpoch: 'epoch',
    startedAt: 'now',
    verifier: 'IntegrationController'
  })
  expect(store.getVerificationRun('explicit')).toMatchObject({
    verifier: 'IntegrationController',
    status: 'RUNNING',
    claimCount: 1,
    runtimeEpoch: 'epoch'
  })
  store.claimVerificationRun({ id: 'default', runtimeEpoch: 'epoch', startedAt: 'now' })
  expect(store.getVerificationRun('default')?.verifier).toBe('VerificationService')
  expect(() =>
    store.claimVerificationRun({
      id: 'empty',
      runtimeEpoch: 'epoch',
      startedAt: 'now',
      verifier: ''
    })
  ).toThrow()
  expect(store.getVerificationRun('empty')?.status).toBe('QUEUED')
})

it('lists the runs of a batch only when the batch is named', () => {
  const input = {
    missionId: 'm',
    taskId: 't',
    candidateId: 'c',
    status: 'QUEUED' as const,
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'IntegrationController'
  }
  const candidate1 = store.insertVerificationRun({ ...input, id: 'candidate-1' })
  const batch1 = store.insertVerificationRun({ ...input, id: 'z-first', batchId: 'A' })
  const candidate2 = store.insertVerificationRun({
    ...input,
    id: 'candidate-2',
    taskId: 't2',
    candidateId: 'c2',
    status: 'PASS'
  })
  const batch2 = store.insertVerificationRun({
    ...input,
    id: 'a-second',
    batchId: 'A',
    taskId: 't2',
    candidateId: 'c2',
    status: 'PASS'
  })
  const batch3 = store.insertVerificationRun({ ...input, id: 'third', batchId: 'B' })
  expect(store.listVerificationRuns({ missionId: 'm' })).toEqual([candidate1, candidate2])
  expect(store.listVerificationRuns({ missionId: 'm', batchId: 'A' })).toEqual([batch1, batch2])
  expect(store.listVerificationRuns({ missionId: 'm', batchId: 'B' })).toEqual([batch3])
  expect(store.listVerificationRuns({ missionId: 'm', batchId: 'absent' })).toEqual([])
  for (const filter of [{ taskId: 't2' }, { candidateId: 'c2' }, { status: 'PASS' as const }]) {
    expect(store.listVerificationRuns({ missionId: 'm', ...filter })).toEqual([candidate2])
    expect(store.listVerificationRuns({ missionId: 'm', batchId: 'A', ...filter })).toEqual([
      batch2
    ])
    expect(store.listVerificationRuns({ missionId: 'm', batchId: 'B', ...filter })).toEqual([])
  }
  expect(store.listVerificationRunsByStatus('QUEUED')).toHaveLength(3)
  expect(store.listVerificationRunsByStatus('QUEUED')).toEqual(
    expect.arrayContaining([candidate1, batch1, batch3])
  )
})
