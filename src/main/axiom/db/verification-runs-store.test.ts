import { afterAll, afterEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from './axiom-store'
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
