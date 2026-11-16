import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { recordIntegrationBase } from './integration-fixture.test-support'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import {
  regressionFixtures,
  regressionCommands,
  batchRuns,
  scratchReturned,
  verdictEvidence,
  gateOutput
} from './integration-regression-fixture.test-support'

const fixture = regressionFixtures()

it('runs the regression on the merge commit and makes the batch promotable', async () => {
  const f = await fixture()
  await f.git('checkout', '--detach', f.baseSha)
  await writeFile(path.join(f.repo, 'integration.txt'), 'integration')
  await f.git('add', 'integration.txt')
  await f.git('commit', '--no-gpg-sign', '-qm', 'integration advance')
  const head = await f.git('rev-parse', 'HEAD')
  await f.git('update-ref', f.integrationRef, head)
  recordIntegrationBase(f, head)
  const setup = 'node -e ""'
  const criterion = `node -e "const fs=require('node:fs'); if(!fs.existsSync('integration.txt') || !fs.existsSync('${f.scopePath}')) process.exit(1)"`
  const gate = 'git rev-parse HEAD'
  regressionCommands(f, [criterion], { setupCommands: [setup], integrationGates: [gate] })
  f.enqueue()
  await f.run()
  expect(f.batches()[0].status).toBe('PROMOTED')
  expect(f.effect()).toMatchObject({ status: 'done', attempts: 0 })
  const batch = f.batches()[0]
  const runs = batchRuns(f)
  expect(runs).toHaveLength(1)
  const run = runs[0]
  const baseline = {
    kind: 'integration_merge',
    batchId: batch.id,
    baseCommit: head,
    mergeCommit: batch.mergeCommit
  }
  expect(run).toMatchObject({
    status: 'PASS',
    batchId: batch.id,
    verifier: 'IntegrationController',
    runtimeEpoch: 'current',
    claimCount: 1,
    startedAt: expect.any(String),
    finishedAt: expect.any(String),
    commands: [setup, criterion, gate],
    toolVersions: { node: expect.any(String), pnpm: expect.any(String), git: expect.any(String) },
    verdictDetail: {
      phase: 'verdict',
      verdict: 'PASS',
      reason: 'checks_passed',
      baseline,
      evidenceArtifactIds: [expect.any(String)],
      checks: [
        expect.objectContaining({ source: 'setup', command: setup, result: 'pass' }),
        expect.objectContaining({
          source: 'evidence',
          command: criterion,
          result: 'pass',
          criteria: [0]
        }),
        expect.objectContaining({ source: 'gate', command: gate, result: 'pass' })
      ]
    }
  })
  expect(run.verdictDetail).not.toHaveProperty('escalation')
  expect(run.verdictDetail).not.toHaveProperty('detail')
  expect(await gateOutput(f)).toBe(batch.mergeCommit)
  const { meta, evidence } = await verdictEvidence(f)
  expect(meta).toMatchObject({
    kind: 'evidence',
    mediaType: 'application/json',
    createdBy: 'IntegrationController',
    related: [run.id, f.task.taskId, f.candidate.id, batch.id]
  })
  expect(evidence).toMatchObject({
    verdict: 'PASS',
    reason: 'checks_passed',
    baseline,
    batchId: batch.id,
    runId: run.id,
    taskId: f.task.taskId,
    candidateId: f.candidate.id,
    runtimeEpoch: 'current',
    claim: 1,
    deadline: expect.any(String),
    startedAt: expect.any(String),
    finishedAt: run.finishedAt,
    toolVersions: run.toolVersions,
    tools: expect.any(Array)
  })
  expect(await f.git('rev-parse', f.integrationRef)).toBe(batch.mergeCommit)
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
  expect(f.store.getCandidate(f.candidate.id)?.status).toBe('ACTIVE')
  await scratchReturned(f)
  const events = f
    .audits()
    .filter((e) => e.objectId === batch.id && e.event.startsWith('integration.'))
  expect(events.map((e) => e.event)).toEqual([
    'integration.batch_started',
    'integration.batch_merged',
    'integration.regression_started',
    'integration.batch_promotable',
    'integration.batch_promoted'
  ])
  expect(events[2].after).toEqual({
    status: 'TESTING',
    runId: run.id,
    mergeCommit: batch.mergeCommit,
    commandCount: 3
  })
  expect(events[3].after).toEqual({
    status: 'PROMOTABLE',
    runId: run.id,
    mergeCommit: batch.mergeCommit
  })
  expect(
    f.audits().filter((e) => e.objectId === run.id && e.event.startsWith('verification.'))
  ).toEqual([])
  expect(f.store.listVerificationRuns({ missionId: f.missionId })).not.toContainEqual(run)
  expect(
    f.store.listVerificationRuns({ missionId: f.missionId, taskId: f.task.taskId })
  ).not.toContainEqual(run)
  const before = { batches: f.batches(), runs: batchRuns(f), audits: f.audits() }
  await f.effects.stop()
  f.enqueue()
  await f.run()
  expect(f.effect()?.status).toBe('done')
  expect({ batches: f.batches(), runs: batchRuns(f), audits: f.audits() }).toEqual(before)

  const empty = await fixture()
  regressionCommands(empty, [])
  empty.enqueue()
  await empty.run()
  expect(empty.batches()[0].status).toBe('PROMOTED')
  expect(batchRuns(empty)[0]).toMatchObject({
    status: 'PASS',
    commands: [],
    verdictDetail: { reason: 'checks_passed', detail: 'no_commands' }
  })
})

it('fails the batch when a regression command fails and sends the Task back', async () => {
  for (const exhausted of [false, true]) {
    const f = await fixture()
    regressionCommands(f, ['node -e "process.exit(1)"'])
    if (exhausted) {
      f.db.db
        .prepare('UPDATE task_stages SET attempt_count = ? WHERE task_id = ?')
        .run(f.task.retryPolicy.maxAttempts, f.task.taskId)
    }
    const count = f.store.getTaskStage(f.task.taskId)!.attemptCount
    f.store.insertSubmission({
      id: 'worker-report',
      missionId: f.missionId,
      taskId: f.task.taskId,
      attemptId: f.candidate.attemptId,
      candidateId: f.candidate.id,
      report: {
        summary: 'Submitted',
        filesChanged: [],
        checksRun: [],
        artifacts: [],
        limitations: [],
        risks: [],
        questions: [],
        followUps: []
      }
    })
    f.enqueue()
    await f.run()
    expect(f.batches()[0].status).toBe('FAILED')
    const batch = f.batches()[0]
    const run = batchRuns(f)[0]
    expect(run).toMatchObject({ status: 'FAIL', verdictDetail: { reason: 'checks_failed' } })
    expect(f.store.getCandidate(f.candidate.id)).toMatchObject({
      status: 'SUPERSEDED',
      supersededBy: null
    })
    expect(f.audits()).toContainEqual(
      expect.objectContaining({
        event: 'candidate.superseded',
        objectId: f.candidate.id,
        after: { status: 'SUPERSEDED', supersededBy: null, reason: 'integration_regression_failed' }
      })
    )
    expect(
      f
        .audits()
        .filter((e) => e.event === 'task.stage')
        .slice(-2)
        .map((e) => e.after)
    ).toEqual([
      expect.objectContaining({ stage: 'NEEDS_FIX', reason: 'integration_regression_failed' }),
      expect.objectContaining({
        stage: exhausted ? 'BLOCKED' : 'READY',
        reason: exhausted ? 'retry_budget_exhausted' : 'retry'
      })
    ])
    expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
      stage: exhausted ? 'BLOCKED' : 'READY',
      attemptCount: count
    })
    expect(f.effect()?.status).toBe('done')
    expect(await f.git('rev-parse', `refs/axiom/batches/${batch.id}/merged`)).toBe(
      batch.mergeCommit
    )
    expect(await f.git('rev-parse', f.integrationRef)).toBe(f.baseSha)
    await scratchReturned(f)
    expect(f.audits()).toContainEqual(
      expect.objectContaining({
        event: 'integration.batch_failed',
        objectId: batch.id,
        after: { status: 'FAILED', runId: run.id, reason: 'checks_failed' }
      })
    )
    expect(resolveAttemptBaseline(f.store, { taskId: f.task.taskId, seq: 2 })).toEqual({
      kind: 'integration',
      reason: 'previous_candidate_superseded'
    })
  }
})
