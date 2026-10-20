import { afterEach, beforeEach, expect, it } from 'vitest'
import { z } from 'zod'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from './axiom-store'
import {
  CandidateRowSchema,
  SubmissionRowSchema,
  VerificationRunRowSchema
} from './submission-rows'
import type { SubmissionReport } from '../../../shared/axiom-contract/submission-params'

let db: OrchestrationDb
let store: AxiomStore
const report: SubmissionReport = {
  summary: 'Task report',
  filesChanged: ['file.ts'],
  checksRun: [{ command: 'test', result: 'skipped', note: 'stub' }],
  artifacts: ['art-1'],
  limitations: ['stub'],
  risks: [],
  questions: [],
  followUps: ['verify']
}
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
})
afterEach(() => db.close())
const candidate = {
  id: 'cand-1',
  missionId: 'm',
  taskId: 't',
  attemptId: 'a',
  commitSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40),
  status: 'ACTIVE' as const,
  supersededBy: null
}

it.each([
  { table: 'candidates', schema: CandidateRowSchema },
  { table: 'submissions', schema: SubmissionRowSchema },
  { table: 'verification_runs', schema: VerificationRunRowSchema }
])('pins $table codecs to the existing schema without a migration', ({ table, schema }) => {
  const columns = z
    .array(z.object({ name: z.string() }))
    .parse(db.db.pragma(`table_info(${table})`))
  expect(Object.keys(schema.shape).sort()).toEqual(columns.map((c) => c.name).sort())
})
it('round-trips immutable reports and refuses a second row for the same dispatch', () => {
  store.insertCandidate(candidate)
  const input = {
    id: 'sub-1',
    missionId: 'm',
    taskId: 't',
    attemptId: 'a',
    candidateId: 'cand-1',
    report
  }
  const saved = store.insertSubmission(input)
  expect(saved).toMatchObject({
    ...input,
    checksRun: report.checksRun,
    limitations: report.limitations,
    followUps: report.followUps
  })
  expect(store.getSubmissionByDispatch('a')).toEqual(saved)
  expect(store.listSubmissions('m')).toEqual([saved])
  expect(() =>
    store.insertSubmission({ ...input, id: 'sub-2', report: { ...report, summary: 'replace' } })
  ).toThrow()
  expect(store.getSubmissionByDispatch('a')).toEqual(saved)
})
it('retains superseded identities and refuses the same Task/commit in another Attempt', () => {
  store.insertCandidate(candidate)
  const second = store.insertCandidate({
    ...candidate,
    id: 'cand-2',
    attemptId: 'a2',
    commitSha: 'c'.repeat(40)
  })
  store.supersedeActiveCandidates('t', second.id)
  expect(store.getCandidate(candidate.id)).toMatchObject({
    status: 'SUPERSEDED',
    supersededBy: second.id
  })
  expect(store.listCandidates('m').filter((c) => c.status === 'ACTIVE')).toEqual([second])
  expect(() => store.insertCandidate({ ...candidate, id: 'cand-3', attemptId: 'a3' })).toThrow(
    'candidate_exists'
  )
})
it('queues verification with valid empty evidence and filters by Mission/status', () => {
  const saved = store.insertVerificationRun({
    id: 'v1',
    missionId: 'm',
    taskId: 't',
    candidateId: 'cand-1',
    status: 'QUEUED',
    commands: [],
    toolVersions: {},
    verdictDetail: {},
    verifier: 'VerificationService'
  })
  expect(store.getVerificationRun('v1')).toEqual(saved)
  expect(store.listVerificationRuns({ missionId: 'm', status: 'QUEUED' })).toEqual([saved])
  expect(store.listVerificationRuns({ missionId: 'm', status: 'PASS' })).toEqual([])
  expect(store.listVerificationRuns({ missionId: 'other' })).toEqual([])
  expect(store.getVerificationRun('missing')).toBeUndefined()
})
it('rejects corrupt JSON without echoing its content', () => {
  store.insertSubmission({
    id: 's',
    missionId: 'm',
    taskId: 't',
    attemptId: 'a',
    candidateId: 'c',
    report
  })
  db.db.prepare('UPDATE submissions SET report = ? WHERE id = ?').run('private invalid JSON', 's')
  expect(() => store.getSubmissionByDispatch('a')).toThrow(
    'Invalid stored JSON in submissions row s column report'
  )
})
