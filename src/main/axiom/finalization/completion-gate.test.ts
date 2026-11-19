import { afterEach, beforeEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { completionGate } from './completion-gate'
import { FINALIZATION_GATE_IDS } from '../../../shared/axiom-contract/mission-finalization'
import { finalizationFixture, facts, setStage } from './finalization-fixture.test-support'

let f: ReturnType<typeof finalizationFixture>
beforeEach(() => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
})
afterEach(() => f.db.close())
const gate = () => completionGate(f.store, f.db, f.missionId, facts)
const item = (id: string) => gate().find((entry) => entry.id === id)!

it('passes when every Task is integrated with a passing run and a promoted batch', () => {
  expect(gate().every((entry) => entry.pass)).toBe(true)
  expect(item('tasks_settled').evidence).toEqual(f.tasks.map((task) => task.taskId))
  expect(item('candidates_verified').evidence).toEqual(f.tasks.map((task) => `run-${task.taskId}`))
  expect(item('batches_promoted').evidence).toEqual(f.tasks.map((task) => `batch-${task.taskId}`))
})
it('fails tasks_settled when a Task is neither integrated nor canceled', () => {
  setStage(f.store, f.tasks[0].taskId, 'RUNNING')
  expect(item('tasks_settled').pass).toBe(false)
  for (const task of f.tasks) {
    setStage(f.store, task.taskId, 'CANCELED')
  }
  expect(item('tasks_settled').pass).toBe(false)
})
it('fails candidates_verified when an integrated Task has no passing run of its active candidate', () => {
  const taskId = f.tasks[0].taskId
  f.store.insertVerificationRun({
    id: 'later-fail',
    missionId: f.missionId,
    taskId,
    candidateId: `candidate-${taskId}`,
    status: 'FAIL',
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'test'
  })
  expect(item('candidates_verified')).toMatchObject({
    pass: false,
    detail: expect.stringContaining(taskId)
  })
  f.store.supersedeActiveCandidate(`candidate-${taskId}`)
  expect(item('candidates_verified').pass).toBe(false)
})
it('fails batches_promoted when the latest batch is not promoted or its regression did not pass', () => {
  const taskId = f.tasks[0].taskId
  f.store.insertVerificationRun({
    id: 'later-regression',
    missionId: f.missionId,
    taskId,
    candidateId: `candidate-${taskId}`,
    batchId: `batch-${taskId}`,
    status: 'FAIL',
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'test'
  })
  expect(item('batches_promoted').pass).toBe(false)
  f.store.insertIntegrationBatch({
    id: 'latest-batch',
    missionId: f.missionId,
    baseCommit: facts.targetHead,
    candidateIds: [`candidate-${taskId}`],
    status: 'QUEUED'
  })
  expect(item('batches_promoted')).toMatchObject({
    pass: false,
    evidence: expect.arrayContaining(['latest-batch'])
  })
})
it('fails goal_criteria_covered when only a canceled Task covers a criterion', () => {
  setStage(f.store, f.tasks[0].taskId, 'CANCELED')
  const task = f.tasks[1]
  f.store.updateTaskSpec({
    taskId: task.taskId,
    expectedStage: 'INTEGRATED',
    retryPolicy: task.retryPolicy,
    spec: { ...task.spec, coversGoalCriteria: [] }
  })
  expect(item('goal_criteria_covered')).toMatchObject({
    pass: false,
    detail: expect.stringContaining('0')
  })
})
it('fails no_open_questions while a Task has a pending question', () => {
  const pending = f.db.createGate({ taskId: f.tasks[0].taskId, question: 'Confirm scope' })
  expect(item('no_open_questions').pass).toBe(false)
  f.db.resolveGate(pending.id, 'resolved')
  expect(item('no_open_questions').pass).toBe(true)
})
it('reports every item in contract order and cuts evidence at 200 entries', () => {
  f.db.close()
  f = finalizationFixture(new OrchestrationDb(':memory:'), 201)
  const result = gate()
  expect(result.map((entry) => entry.id)).toEqual(FINALIZATION_GATE_IDS)
  expect(result.every((entry) => entry.pass && entry.evidence.length <= 200)).toBe(true)
  expect(result.slice(0, 3).map((entry) => entry.evidence.length)).toEqual([200, 200, 200])
  const failed = completionGate(f.store, f.db, f.missionId, {
    ...facts,
    integrationHead: facts.targetHead,
    targetContained: false
  })
  expect(failed.filter((entry) => !entry.pass).map((entry) => entry.id)).toEqual([
    'integration_head_recorded',
    'target_branch_contained'
  ])
})
