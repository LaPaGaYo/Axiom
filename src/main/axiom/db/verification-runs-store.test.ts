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
  expect(runs.listVerificationRuns({ missionId: 'm' })).toEqual([batch])
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
