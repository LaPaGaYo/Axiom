import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
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
  branch: z.string()
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
              'SELECT task_id, dispatch_id, seq, branch FROM attempt_bindings WHERE mission_id = ? AND dispatch_id IS NOT NULL ORDER BY task_id, seq'
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
    async ({ clone, userData, ledgerPath, temp, mission }) => {
      const baseRef = `refs/heads/axiom/integration/${mission.id}`
      const base = git(['-C', clone, 'rev-parse', baseRef])
      const baseTree = git(['-C', clone, 'rev-parse', `${baseRef}^{tree}`])
      expect(base).toBe(FIXTURE_COMMIT)
      await expect
        .poll(
          () => inspect(userData, mission.id).tasks.filter((t) => t.stage === 'SUBMITTED').length,
          { timeout: 120_000 }
        )
        .toBe(3)
      const settled = inspect(userData, mission.id)
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
          status: 'QUEUED',
          verifier: 'VerificationService'
        })
      }
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
      console.log(
        `[M2-07] ${JSON.stringify({ missionId: mission.id, submitted: 3, activeCandidates: 3, submissions: 3, queuedVerificationRuns: 3, completedDispatches: 3, candidateCommits: settled.candidates.map((c) => c.commitSha), integrationBaseUnchanged: base, forgedSubmit: 'dispatch_capability_invalid', totalMs: performance.now() - started })}`
      )
    }
  )
})
