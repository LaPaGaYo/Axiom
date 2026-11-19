import { afterEach, beforeEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  completionReportText,
  CompletionReportSchema
} from '../../../shared/axiom-contract/completion-report'
import { finalizationFixture, facts, setStage } from './finalization-fixture.test-support'
import { reportAttempt } from './completion-report-fixture.test-support'
import { buildCompletionReport } from './completion-report'

let f: ReturnType<typeof finalizationFixture>
beforeEach(() => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
})
afterEach(() => f.db.close())
const build = () => buildCompletionReport(f.store, f.db, f.missionId, facts)

function reviewedRun() {
  const taskId = f.tasks[0].taskId
  for (const id of ['verdict', 'evidence']) {
    f.store.insertArtifact({
      id,
      missionId: f.missionId,
      kind: 'evidence',
      sha256: 'c'.repeat(64),
      sizeBytes: 1,
      mediaType: 'application/json',
      related: [taskId],
      createdBy: 'test'
    })
  }
  return f.store.insertVerificationRun({
    id: 'reviewed-run',
    missionId: f.missionId,
    taskId,
    candidateId: `candidate-${taskId}`,
    status: 'PASS',
    verifier: 'VerificationService',
    toolVersions: { node: '24.21.0' },
    commands: ['pnpm test'],
    verdictDetail: {
      checks: [{ index: 0, command: 'pnpm test', result: 'pass', criteria: [0] }],
      resolution: {
        verdict: 'PASS',
        rationale: 'Reviewed the evidence',
        by: 'user',
        at: '2026-11-19T12:00:00Z'
      },
      verdictArtifactId: 'verdict',
      evidenceArtifactIds: ['evidence', 'missing']
    }
  })
}

it('the report names the goal with its coverage and every revision of the goal and the plan', () => {
  const [oldGoal] = f.store.listGoalRevisions(f.missionId)
  f.store.updateGoalRevisionStatus({ id: oldGoal.id, from: 'ACTIVE', to: 'SUPERSEDED' })
  const active = f.store.insertGoalRevision(
    {
      ...oldGoal,
      objective: 'Revised objective',
      acceptanceCriteria: ['Checks pass', 'Canceled coverage']
    },
    { missionId: f.missionId, status: 'ACTIVE' }
  )
  f.store.setActiveRevisions({ id: f.missionId, activeGoalRevisionId: active.id })
  f.store.insertGoalRevision(
    { ...oldGoal, objective: 'Future objective' },
    { missionId: f.missionId, status: 'PROPOSED' }
  )
  const [oldPlan] = f.store.listPlanRevisions(f.missionId)
  const next = f.store.insertPlanRevision(
    {
      ...oldPlan,
      goalRevisionId: active.id,
      provenance: { ...oldPlan.provenance, kind: 'planner', model: 'fixture-model' },
      risks: [{ id: 'risk', description: 'Local validation', mitigation: 'Review' }]
    },
    { missionId: f.missionId, status: 'REJECTED', supersedesId: oldPlan.id }
  )
  const canceled = f.tasks[1]
  f.store.updateTaskSpec({
    taskId: canceled.taskId,
    expectedStage: canceled.stage,
    retryPolicy: canceled.retryPolicy,
    spec: { ...canceled.spec, coversGoalCriteria: [1] }
  })
  setStage(f.store, canceled.taskId, 'CANCELED')
  f.db.db
    .prepare(
      `INSERT INTO decisions (id, mission_id, status, title, options, authority, provenance) VALUES ('decision', ?, 'ACCEPTED', 'Scope', '[]', 'user', '{}')`
    )
    .run(f.missionId)
  const report = build()
  expect(report.mission).toEqual({ id: f.missionId, repoId: 'repo', targetBranch: 'main' })
  expect(report.goal).toEqual({
    id: active.id,
    revision: 2,
    objective: active.objective,
    constraints: active.constraints,
    criteria: [
      { index: 0, text: 'Checks pass', coveredBy: [f.tasks[0].taskId] },
      { index: 1, text: 'Canceled coverage', coveredBy: [] }
    ],
    revisions: f.store
      .listGoalRevisions(f.missionId)
      .map(({ id, revision, status }) => ({ id, revision, status }))
  })
  expect(report.plans.map((p) => p.id)).toEqual([oldPlan.id, next.id])
  expect(report.plans[1]).toEqual({
    id: next.id,
    revision: 2,
    status: 'REJECTED',
    goalRevisionId: active.id,
    supersedesId: oldPlan.id,
    provenance: { kind: 'planner', actor: next.provenance.actor, model: 'fixture-model' },
    taskIds: next.tasks.map((task) => task.id),
    risks: next.risks
  })
  expect(report.tasks.map((task) => task.planTaskId)).toEqual(f.tasks.map((task) => task.spec.id))
  expect(report.decisions).toEqual(['decision'])
})

it('an integrated Task carries its attempts candidate submission verification batch and runs', () => {
  const task = f.tasks[0]
  reportAttempt(f.store, task, 2)
  const latest = reviewedRun()
  const report = build()
  const row = report.tasks[0]
  expect(row.stage).toBe('INTEGRATED')
  if (row.stage !== 'INTEGRATED') {
    throw new Error('Expected integrated Task')
  }
  const binding = f.store.getAttemptBinding(task.taskId, 1)!
  expect(row.attempts).toHaveLength(2)
  expect(row.attempts[0]).toEqual({
    seq: 1,
    branch: binding.branch,
    agentSpecId: binding.agentSpecId,
    contextPackageId: binding.contextPackageId,
    provider: 'codex',
    model: 'fixture-model',
    effort: 'high',
    candidateId: `candidate-${task.taskId}`
  })
  expect(row.attempts[1]).not.toHaveProperty('candidateId')
  expect(row.attempts[0]).not.toHaveProperty('channel')
  expect(row.attempts[0]).not.toHaveProperty('posture')
  expect(row.candidate).toEqual({
    id: `candidate-${task.taskId}`,
    commitSha: facts.integrationHead,
    treeSha: facts.targetHead
  })
  const submission = f.store.getSubmissionByDispatch(binding.dispatchId!)!
  expect(row).toMatchObject({
    summary: submission.report.summary,
    limitations: submission.report.limitations,
    risks: submission.report.risks,
    followUps: submission.report.followUps
  })
  expect(row.verification).toEqual({
    runId: latest.id,
    status: 'PASS',
    verifier: latest.verifier,
    toolVersions: latest.toolVersions,
    checks: [{ command: 'pnpm test', result: 'pass', criteria: [0] }],
    resolution: { verdict: 'PASS', rationale: 'Reviewed the evidence', at: '2026-11-19T12:00:00Z' },
    artifacts: [
      { id: 'verdict', sha256: 'c'.repeat(64) },
      { id: 'evidence', sha256: 'c'.repeat(64) }
    ]
  })
  expect(row.integration).toEqual({
    batchId: `batch-${task.taskId}`,
    baseCommit: facts.targetHead,
    mergeCommit: facts.integrationHead,
    regressionRunId: `regression-${task.taskId}`,
    regressionStatus: 'PASS'
  })
  expect(row.runs).toEqual([
    { id: `run-${task.taskId}`, candidateId: `candidate-${task.taskId}`, status: 'PASS' },
    { id: latest.id, candidateId: latest.candidateId, status: 'PASS' },
    {
      id: `regression-${task.taskId}`,
      candidateId: latest.candidateId,
      status: 'PASS',
      batchId: `batch-${task.taskId}`
    }
  ])
  expect(report.commits).toEqual({
    integrationHead: facts.integrationHead,
    targetHead: facts.targetHead,
    promoted: [facts.integrationHead, facts.integrationHead]
  })
  expect(report.gate).toHaveLength(8)
  expect(report.gate.every((item) => item.pass)).toBe(true)
})

it('a canceled Task carries its rationale and a settled Task its unanswered questions', () => {
  const task = f.tasks[0]
  setStage(f.store, task.taskId, 'CANCELED')
  f.store.appendAuditEvent({
    missionId: f.missionId,
    actor: 'user',
    objectKind: 'task',
    objectId: task.taskId,
    event: 'task.stage',
    before: null,
    after: { stage: 'CANCELED', reason: 'No longer needed' }
  })
  const runId = f.store.getMission(f.missionId)!.runId
  const gate = f.db.createGate({ taskId: task.taskId, question: 'Confirm cancellation' })
  const message = f.db.insertMessage({
    from: 'system',
    to: `run:${runId}`,
    runId,
    type: 'question',
    subject: 'Report question',
    body: 'Unanswered report question',
    payload: JSON.stringify({
      axiom: {
        version: 1,
        missionId: f.missionId,
        taskId: task.taskId,
        attemptId: `attempt-${task.taskId}`,
        type: 'QUESTION',
        summary: 'Unanswered report question',
        artifactIds: [],
        related: {},
        question: { text: 'Unanswered report question', options: [] }
      }
    })
  })
  const integrated = f.tasks[1]
  const { dispatch } = f.db.createStartingWorkerDispatch({
    taskId: integrated.taskId,
    creator: { kind: 'system' },
    maxDepth: 1,
    startOptions: { topology: 'current', agent: 'codex' }
  })
  reportAttempt(f.store, integrated, 2, dispatch.id)
  const thread = f.db.createQuestion({
    runId,
    dispatchId: dispatch.id,
    askerHandle: 'worker',
    question: 'Kernel thread question'
  })
  expect(f.store.hasPendingQuestionForTask(integrated.taskId)).toBe(true)
  const report = build()
  expect(report.tasks[0]).toMatchObject({
    stage: 'CANCELED',
    cancelRationale: 'No longer needed',
    openQuestions: [
      { source: 'message', id: message.id, text: 'Unanswered report question' },
      { source: 'gate', id: gate.id, text: 'Confirm cancellation' }
    ]
  })
  expect(report.tasks[0]).not.toHaveProperty('candidate')
  expect(report.tasks[1].openQuestions).toEqual([
    { source: 'message', id: thread.message.id, text: 'Kernel thread question' }
  ])
  expect(report.gate.find((item) => item.id === 'no_open_questions')?.pass).toBe(true)
})

it('a bypass posture and a human resolved verification are listed under risks', () => {
  const taskId = f.tasks[0].taskId
  f.store.appendAuditEvent({
    missionId: f.missionId,
    actor: 'launcher',
    objectKind: 'attempt',
    objectId: `attempt-${taskId}`,
    event: 'attempt.started',
    before: null,
    after: { channel: 'tui', posture: 'tui-bypass' }
  })
  reviewedRun()
  const report = build()
  expect(report.tasks[0].attempts[0]).toMatchObject({ channel: 'tui', posture: 'tui-bypass' })
  expect(report.risks).toEqual([
    { kind: 'bypass_posture', taskId, seq: 1 },
    { kind: 'human_resolved_verification', taskId, runId: 'reviewed-run' }
  ])
})

it('two builds give the same bytes and a changed fact gives other bytes', () => {
  const first = completionReportText(build())
  expect(completionReportText(build())).toBe(first)
  expect(CompletionReportSchema.parse(JSON.parse(first))).toEqual(build())
  expect(first.endsWith('\n')).toBe(true)
  const gate = f.db.createGate({ taskId: f.tasks[0].taskId, question: 'A changed fact' })
  expect(completionReportText(build())).not.toBe(first)
  f.db.resolveGate(gate.id, 'resolved')
  expect(completionReportText(build())).toBe(first)
})
