import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { splitWorktreeIdForFilesystem } from '../../src/shared/worktree/id'
import {
  VerificationListResponseSchema,
  VerificationResponseSchema
} from '../../src/shared/axiom-contract/verification-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import {
  FIXTURE_COMMIT,
  cli,
  git,
  invoke,
  withFixtureMission
} from './helpers/axiom-fixture-mission'
import Database from '../../src/main/sqlite/sync-database'
import {
  CandidateRowCodec,
  SubmissionRowCodec,
  VerificationRunRowCodec
} from '../../src/main/axiom/db/submission-rows'
import { AttemptListResponseSchema } from '../../src/shared/axiom-contract/attempt-params'

const Binding = z.object({
  task_id: z.string(),
  dispatch_id: z.string(),
  seq: z.number(),
  branch: z.string(),
  worktree_id: z.string()
})
function inspect(userData: string, missionId: string) {
  const db = new Database(path.join(userData, 'orchestration.db'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    return {
      bindings: z
        .array(Binding)
        .parse(
          db
            .prepare(
              'SELECT b.task_id, b.dispatch_id, b.seq, b.branch, w.worktree_id FROM attempt_bindings b JOIN worker_dispatches w ON w.dispatch_id = b.dispatch_id WHERE b.mission_id = ? AND b.dispatch_id IS NOT NULL ORDER BY b.task_id, b.seq'
            )
            .all(missionId)
        ),
      tasks: z
        .array(z.object({ task_id: z.string(), stage: z.string() }))
        .parse(
          db
            .prepare('SELECT task_id, stage FROM task_stages WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      candidates: z
        .array(CandidateRowCodec)
        .parse(
          db
            .prepare('SELECT * FROM candidates WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      submissions: z
        .array(SubmissionRowCodec)
        .parse(
          db
            .prepare('SELECT * FROM submissions WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      verification: z
        .array(VerificationRunRowCodec)
        .parse(
          db
            .prepare('SELECT * FROM verification_runs WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      dispatches: z
        .array(z.object({ id: z.string(), status: z.string() }))
        .parse(
          db
            .prepare(
              'SELECT d.id, d.status FROM dispatch_contexts d JOIN attempt_bindings b ON b.dispatch_id = d.id WHERE b.mission_id = ? ORDER BY d.id'
            )
            .all(missionId)
        )
    }
  } finally {
    db.close()
  }
}
const LedgerLine = z.object({ kind: z.string().optional(), attemptId: z.string() }).passthrough()
function readLedger(file: string) {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => LedgerLine.parse(JSON.parse(line)))
    : []
}

test('M2-07: three fixture Workers submit immutable Candidates and reject a forged duplicate', async (// oxlint-disable-next-line no-empty-pattern -- Restart helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const started = performance.now()
  await withFixtureMission(
    testInfo,
    source,
    async ({ clone, userData, ledgerPath, temp, mission, restart }) => {
      const baseRef = `refs/heads/axiom/integration/${mission.id}`
      const base = git(['-C', clone, 'rev-parse', baseRef])
      const baseTree = git(['-C', clone, 'rev-parse', `${baseRef}^{tree}`])
      expect(base).toBe(FIXTURE_COMMIT)
      await expect
        .poll(() => inspect(userData, mission.id).submissions.length, { timeout: 120_000 })
        .toBe(3)
      await expect
        .poll(
          () =>
            inspect(userData, mission.id).verification.filter(
              (run) => run.status === 'RUNNING' && run.verdictDetail.phase === 'prepared'
            ).length,
          { timeout: 60_000 }
        )
        .toBe(3)
      const settled = inspect(userData, mission.id)
      const assertWorktree = (run: (typeof settled.verification)[number], claim: number) => {
        const candidate = settled.candidates.find((c) => c.id === run.candidateId)!
        expect(run.worktreeId).toBeTruthy()
        const worktreePath = splitWorktreeIdForFilesystem(run.worktreeId!)!.worktreePath
        expect(git(['-C', worktreePath, 'rev-parse', 'HEAD'])).toBe(candidate.commitSha)
        expect(git(['-C', worktreePath, 'rev-parse', 'HEAD^{tree}'])).toBe(candidate.treeSha)
        const symbolic = spawnSync('git', ['-C', worktreePath, 'symbolic-ref', '-q', 'HEAD'], {
          encoding: 'utf8',
          timeout: 30_000
        })
        expect(symbolic.error).toBeUndefined()
        expect(symbolic.status).toBe(1)
        expect(git(['-C', clone, 'rev-parse', `refs/heads/axiom/verify/${run.id}/${claim}`])).toBe(
          candidate.commitSha
        )
        return worktreePath
      }
      expect(settled.bindings).toHaveLength(3)
      expect(settled.candidates).toHaveLength(3)
      expect(settled.submissions).toHaveLength(3)
      expect(settled.verification).toHaveLength(3)
      expect(settled.dispatches.every((d) => d.status === 'completed')).toBe(true)
      for (const binding of settled.bindings) {
        const candidate = settled.candidates.find((c) => c.attemptId === binding.dispatch_id)!
        const submission = settled.submissions.find((s) => s.attemptId === binding.dispatch_id)!
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
        expect(submission.report.artifacts).toHaveLength(1)
        expect(settled.verification.find((v) => v.candidateId === candidate.id)).toMatchObject({
          taskId: binding.task_id,
          status: 'RUNNING',
          verifier: 'VerificationService',
          claimCount: 1,
          verdictDetail: expect.objectContaining({ phase: 'prepared' })
        })
      }
      const firstPaths = settled.verification.map((run) => {
        expect(run.worktreeId).not.toBe(
          settled.bindings.find((b) => b.task_id === run.taskId)!.worktree_id
        )
        return assertWorktree(run, 1)
      })
      const verifying = TaskListResponseSchema.parse(
        cli(userData, ['task', 'list', '--mission', mission.id, '--stage', 'VERIFYING'])
      ).tasks
      expect(verifying.map((t) => t.id).sort()).toEqual(
        settled.verification.map((r) => r.taskId).sort()
      )
      const views = VerificationListResponseSchema.parse(
        cli(userData, ['verification', 'list', '--mission', mission.id])
      ).runs
      expect(views.map((r) => r.id).sort()).toEqual(settled.verification.map((r) => r.id).sort())
      expect(views.every((r) => r.status === 'RUNNING' && r.phase === 'prepared')).toBe(true)
      expect(
        VerificationResponseSchema.parse(
          cli(userData, ['verification', 'show', '--run', views[0]!.id])
        ).run
      ).toEqual(views[0])
      const attempts = AttemptListResponseSchema.parse(
        cli(userData, ['attempt', 'list', '--mission', mission.id])
      ).attempts
      expect(attempts).toHaveLength(3)
      expect(attempts.every((a) => a.state === 'SUBMITTED')).toBe(true)
      await expect
        .poll(() => readLedger(ledgerPath).filter((e) => e.kind === 'submission').length)
        .toBe(3)
      const ledger = readLedger(ledgerPath)
      expect(ledger.filter((e) => e.kind === undefined)).toHaveLength(3)
      expect(ledger.filter((e) => e.kind === 'artifact')).toHaveLength(3)
      expect(ledger.filter((e) => e.kind === 'error')).toEqual([])
      const forgedReport = path.join(temp, 'forged.json')
      writeFileSync(forgedReport, JSON.stringify(settled.submissions[0]!.report))
      const forged = invoke(userData, [
        'attempt',
        'submit',
        '--attempt',
        settled.bindings[0]!.dispatch_id,
        '--from',
        'term_forged',
        '--dispatch-capability',
        'dcap_wrong',
        '--report',
        forgedReport
      ])
      expect(forged.status).not.toBe(0)
      expect(JSON.parse(forged.stdout)).toMatchObject({
        ok: false,
        error: { code: 'dispatch_capability_invalid' }
      })
      expect(inspect(userData, mission.id)).toEqual(settled)
      expect(git(['-C', clone, 'rev-parse', baseRef])).toBe(base)
      expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(base)
      if (!restart) {
        throw new Error('Restart was not enabled for verification fixture')
      }
      await restart()
      await expect
        .poll(
          () =>
            inspect(userData, mission.id).verification.filter(
              (run) =>
                run.status === 'RUNNING' &&
                run.verdictDetail.phase === 'prepared' &&
                run.claimCount === 2
            ).length,
          { timeout: 60_000 }
        )
        .toBe(3)
      const recovered = inspect(userData, mission.id)
      const audits = inspectFixtureMission(userData, mission.id).audits
      for (const run of recovered.verification) {
        const before = settled.verification.find((old) => old.id === run.id)!
        expect(run.runtimeEpoch).not.toBe(before.runtimeEpoch)
        expect(run.worktreeId).not.toBe(before.worktreeId)
        assertWorktree(run, 2)
        expect(audits.filter((a) => a.object_id === run.id).map((a) => a.event)).toEqual([
          'verification.claimed',
          'verification.prepared',
          'verification.requeued',
          'verification.claimed',
          'verification.prepared'
        ])
      }
      for (const worktreePath of firstPaths) {
        expect(existsSync(worktreePath)).toBe(false)
      }
      expect(recovered.candidates).toEqual(settled.candidates)
      expect(recovered.submissions).toEqual(settled.submissions)
      console.log(
        `[M2-07] ${JSON.stringify({ missionId: mission.id, submitted: 3, activeCandidates: 3, submissions: 3, runningVerificationRuns: 3, requeuedAfterRestart: 3, completedDispatches: 3, candidateCommits: settled.candidates.map((c) => c.commitSha), integrationBaseUnchanged: base, forgedSubmit: 'dispatch_capability_invalid', totalMs: performance.now() - started })}`
      )
    },
    { restart: true }
  )
})
