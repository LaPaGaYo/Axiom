import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import {
  FIXTURE_COMMIT,
  cli,
  git,
  invoke,
  withFixtureMission
} from './helpers/axiom-fixture-mission'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import {
  AttemptListResponseSchema,
  AttemptSubmitResponseSchema
} from '../../src/shared/axiom-contract/attempt-params'

test('M2 exit: Planner, parallel Workers, crash retry and immutable submission fences', async (// oxlint-disable-next-line no-empty-pattern -- Shared helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(360_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ mission, clone, userData, ledgerPath, temp, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const list = () =>
        AttemptListResponseSchema.parse(
          cli(userData, ['attempt', 'list', '--mission', mission.id])
        ).attempts.filter((attempt) => attempt.role === 'worker')
      // The helper has asserted mission plan → PLAN_REVIEW, planner provenance and the 12/20/3 DAG.
      await expect
        .poll(() => list().filter((a) => a.state === 'RUNNING' && a.liveness === 'live').length, {
          timeout: 60_000
        })
        .toBe(3)
      const running = inspect()
      const roots = running.tasks.filter((task) => task.stage === 'RUNNING')
      expect(running.tasks).toHaveLength(12)
      expect(roots).toHaveLength(3)
      expect(running.tasks.filter((task) => task.stage === 'DEFINED')).toHaveLength(9)
      const fixtureId = (task: (typeof roots)[number]) =>
        z.object({ id: z.string() }).parse(JSON.parse(task.spec)).id
      expect(roots.map(fixtureId).sort()).toEqual(['T01', 'T02', 'T03'])
      const workerBindings = running.bindings.filter((b) =>
        roots.some((t) => t.task_id === b.task_id)
      )
      expect(workerBindings).toHaveLength(3)
      expect(workerBindings.every((b) => b.seq === 1 && b.dispatch_id !== null)).toBe(true)
      const crashTask = roots.find((task) => fixtureId(task) === 'T01')!
      const first = workerBindings.find((binding) => binding.task_id === crashTask.task_id)!
      const crashMarker = `${ledgerPath}.crash-${crashTask.task_id}`
      writeFileSync(crashMarker, '')
      releaseWorkers()

      await expect
        .poll(() => inspect().tasks.filter((t) => t.stage === 'VERIFYING').length, {
          timeout: 120_000
        })
        .toBe(3)
      await expect
        .poll(
          () => fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'submission').length,
          { timeout: 30_000 }
        )
        .toBe(3)
      await expect
        .poll(() => inspect().audits.some((a) => a.event === 'planner.stopped'), {
          timeout: 120_000
        })
        .toBe(true)
      await expect
        .poll(
          () =>
            inspect().verification.filter(
              (run) => run.status === 'RUNNING' && run.verdictDetail.phase === 'prepared'
            ).length,
          { timeout: 60_000 }
        )
        .toBe(3)
      const settled = inspect()
      const attempts = list()
      const retry = attempts.find((a) => a.taskId === crashTask.task_id && a.seq === 2)!
      expect(attempts).toHaveLength(4)
      expect(attempts.filter((a) => a.state === 'SUBMITTED')).toHaveLength(3)
      expect(attempts.find((a) => a.attemptId === first.dispatch_id)?.state).toBe('FAILED')
      expect(retry).toMatchObject({
        state: 'SUBMITTED',
        branch: `axiom/attempt/${crashTask.task_id}/2`
      })
      // failDispatch returns the Orca Task to ready after its first failure; kernel retryOf
      // requires failed/blocked (circuit-break/abandon). Axiom lineage is bindings + audits.
      expect(
        settled.workers.find((w) => w.dispatch_id === retry.attemptId)?.retry_of_dispatch_id
      ).toBeNull()
      expect(settled.tasks.find((t) => t.task_id === crashTask.task_id)?.attempt_count).toBe(2)
      expect(settled.candidates.filter((c) => c.taskId === crashTask.task_id)).toHaveLength(1)
      expect(settled.candidates.some((c) => c.attemptId === first.dispatch_id)).toBe(false)
      const failed = settled.audits.find(
        (a) => a.event === 'attempt.failed' && a.object_id === first.dispatch_id
      )!
      const restarted = settled.audits.find(
        (a) => a.event === 'attempt.started' && a.object_id === retry.attemptId
      )!
      expect(failed).toBeDefined()
      expect(JSON.parse(failed.after!)).toMatchObject({
        reason: 'process_exited',
        evidence: process.platform === 'win32' ? 'shell_foreground' : 'exit_code'
      })
      expect(restarted).toBeDefined()
      expect(failed.sequence).toBeLessThan(restarted.sequence)
      expect(JSON.parse(restarted.after!)).toMatchObject({ seq: 2 })
      const stages = settled.audits
        .filter((a) => a.event === 'task.stage' && a.object_id === crashTask.task_id)
        .map((a) => z.object({ stage: z.string() }).parse(JSON.parse(a.after!)).stage)
      expect(stages).toEqual([
        'READY',
        'RUNNING',
        'NEEDS_FIX',
        'READY',
        'RUNNING',
        'SUBMITTED',
        'VERIFYING'
      ])
      const ledger = fixtureLedger(ledgerPath)
      expect(ledger.filter((entry) => entry.kind === 'crash')).toEqual([
        { kind: 'crash', attemptId: first.dispatch_id, taskId: crashTask.task_id }
      ])
      expect(existsSync(crashMarker)).toBe(false)
      expect(ledger.filter((entry) => entry.kind === 'error')).toEqual([])
      expect(ledger.filter((entry) => entry.kind === undefined).length).toBe(5) // Planner + 4 Workers.
      expect(ledger.filter((entry) => entry.kind === 'artifact').length).toBe(3)
      expect(
        ledger.filter((entry) => entry.kind === 'submission').every((entry) => entry.response?.ok)
      ).toBe(true)

      const baseRef = `refs/heads/axiom/integration/${mission.id}`
      const base = git(['-C', clone, 'rev-parse', baseRef])
      const baseTree = git(['-C', clone, 'rev-parse', `${baseRef}^{tree}`])
      expect(base).toBe(FIXTURE_COMMIT)
      expect(
        settled.bindings.filter((b) => settled.tasks.some((t) => t.task_id === b.task_id))
      ).toHaveLength(4)
      expect(settled.candidates).toHaveLength(3)
      expect(settled.submissions).toHaveLength(3)
      expect(settled.verification).toHaveLength(3)
      // Preserve every immutable-Candidate assertion from mission-attempt-submit.spec.ts.
      for (const submission of settled.submissions) {
        const binding = settled.bindings.find((b) => b.dispatch_id === submission.attemptId)!
        const candidate = settled.candidates.find((c) => c.attemptId === binding.dispatch_id)!
        expect(settled.dispatches.find((d) => d.id === binding.dispatch_id)?.status).toBe(
          'completed'
        )
        expect(candidate.status).toBe('ACTIVE')
        expect(candidate.commitSha).toBe(
          git(['-C', clone, 'rev-parse', `refs/heads/${binding.branch}`])
        )
        expect(candidate.commitSha).not.toBe(base)
        expect(candidate.treeSha).toBe(
          git(['-C', clone, 'rev-parse', `${candidate.commitSha}^{tree}`])
        )
        expect(candidate.treeSha).not.toBe(baseTree)
        expect(submission.candidateId).toBe(candidate.id)
        expect(submission.report.summary).not.toBe('')
        expect(submission.report.artifacts).toHaveLength(process.platform === 'win32' ? 1 : 2)
        expect(settled.verification.filter((v) => v.candidateId === candidate.id)).toHaveLength(1)
        expect(settled.verification.find((v) => v.candidateId === candidate.id)).toMatchObject({
          taskId: binding.task_id,
          status: 'RUNNING',
          verifier: 'VerificationService'
        })
      }
      const snapshot = () =>
        JSON.stringify({
          rows: inspect().rows,
          refs: git([
            '-C',
            clone,
            'for-each-ref',
            '--sort=refname',
            '--format=%(refname) %(objectname)'
          ])
        })
      const reportPath = path.join(temp, 'replay-report.json')
      const submission = settled.submissions[0]!
      const candidate = settled.candidates.find((c) => c.id === submission.candidateId)!
      writeFileSync(reportPath, JSON.stringify(submission.report))
      const sender = settled.dispatches.find((d) => d.id === submission.attemptId)!
      if (!sender.assignee_handle || !sender.assignee_pane_key) {
        throw new Error('Missing Worker sender')
      }
      const submitArgs = (attemptId: string, from = sender.assignee_handle!) => [
        'attempt',
        'submit',
        '--attempt',
        attemptId,
        '--from',
        from,
        '--report',
        reportPath
      ]
      const codes: Record<string, string> = {}
      const reject = (kind: string, attemptId: string, from: string, code: string) => {
        const before = snapshot()
        const response = invoke(userData, submitArgs(attemptId, from), {
          paneKey: sender.assignee_pane_key!
        })
        expect(response.error).toBeUndefined()
        expect(response.signal).toBeNull()
        expect(response.status).not.toBe(0)
        expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, error: { code } })
        expect(snapshot()).toBe(before)
        codes[kind] = code
      }
      reject('forged', submission.attemptId, 'term_forged', 'worker_identity_changed')
      const beforeDuplicate = snapshot()
      const duplicate = AttemptSubmitResponseSchema.parse(
        cli(userData, submitArgs(submission.attemptId), {
          paneKey: sender.assignee_pane_key
        })
      )
      expect(duplicate).toEqual({ submission, candidate, duplicate: true })
      expect(snapshot()).toBe(beforeDuplicate)
      codes.duplicate = 'duplicate:true'
      // Recovery has already revoked seq 1. The inactive check precedes the newer-seq check.
      reject('stale', first.dispatch_id!, sender.assignee_handle, 'inactive_dispatch')
      const other = settled.submissions.find((s) => s.attemptId !== submission.attemptId)!
      reject(
        'mismatched',
        submission.attemptId,
        settled.dispatches.find((d) => d.id === other.attemptId)!.assignee_handle!,
        'worker_identity_changed'
      )
      expect(git(['-C', clone, 'rev-parse', baseRef])).toBe(base)
      expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(base)
      const measurements = {
        missionId: mission.id,
        fixtureCommit: base,
        tasks: 12,
        edges: 20,
        parallelRunning: 3,
        submitted: 3,
        candidates: 3,
        runningVerificationRuns: 3,
        codes,
        crashAttempt: first.dispatch_id,
        retryAttempt: retry.attemptId,
        failedSequence: failed.sequence,
        retryStartedSequence: restarted.sequence,
        candidateCommits: settled.candidates.map((c) => c.commitSha),
        snapshotsIdentical: true
      }
      console.log(`[M2-exit] ${JSON.stringify(measurements)}`)
      await testInfo.attach('M2-exit-measurements', {
        body: JSON.stringify(measurements),
        contentType: 'application/json'
      })
    },
    { planner: true, holdWorkers: true }
  )
})
