import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import Database from '../../src/main/sqlite/sync-database'
import { test, expect } from './helpers/orca-app'
import { cli, withFixtureMission } from './helpers/axiom-fixture-mission'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { AttemptResponseSchema } from '../../src/shared/axiom-contract/attempt-params'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'

function terminalResources(userData: string, missionId: string) {
  const db = new Database(path.join(userData, 'orchestration.db'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    return z.array(z.object({ owner_dispatch_id: z.string(), release_state: z.string() })).parse(
      db
        .prepare(`SELECT r.owner_dispatch_id, r.release_state FROM worker_terminal_resources r
        JOIN attempt_bindings b ON b.dispatch_id = r.owner_dispatch_id
        WHERE b.mission_id = ? ORDER BY r.owner_dispatch_id`)
        .all(missionId)
    )
  } finally {
    db.close()
  }
}

test('D76: archives redacted Worker output before releasing submitted terminals', async (// oxlint-disable-next-line no-empty-pattern -- Fixture helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ mission, userData, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const show = (attemptId: string) =>
        AttemptResponseSchema.parse(cli(userData, ['attempt', 'show', '--attempt', attemptId]))
          .attempt
      await expect
        .poll(() => inspect().tasks.filter((task) => task.stage === 'RUNNING').length, {
          timeout: 60_000
        })
        .toBe(3)
      const roots = inspect().tasks.filter((task) => task.stage === 'RUNNING')
      const secretTask = roots.find(
        (task) => z.object({ id: z.string() }).parse(JSON.parse(task.spec)).id === 'T01'
      )
      if (!secretTask) {
        throw new Error('Missing fixture Task T01')
      }
      writeFileSync(`${ledgerPath}.scenario-${secretTask.task_id}`, 'transcript-secret')
      releaseWorkers()
      await expect
        .poll(
          () => fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'submission').length,
          { timeout: 120_000 }
        )
        .toBe(3)
      const ledger = fixtureLedger(ledgerPath)
      expect(ledger.filter((entry) => entry.kind === 'error')).toEqual([])
      expect(
        ledger.filter((entry) => entry.kind === 'submission').every((entry) => entry.response?.ok)
      ).toBe(true)
      const submissions = inspect().submissions
      expect(submissions).toHaveLength(3)
      for (const submission of submissions) {
        const archived = inspect().audits.find(
          (audit) =>
            audit.object_id === submission.attemptId &&
            audit.event === 'attempt.transcript_archived'
        )
        expect(archived).toBeDefined()
        const transcriptArtifactId = show(submission.attemptId).submission?.transcriptArtifactId
        expect(transcriptArtifactId).toBeTruthy()
        if (!transcriptArtifactId) {
          throw new Error('Missing transcript Artifact reference')
        }
        expect(JSON.parse(archived!.after ?? '{}')).toMatchObject({
          submissionId: submission.id,
          artifactId: transcriptArtifactId
        })
        const artifact = ArtifactReadResponseSchema.parse(
          cli(userData, ['mission', 'artifact', 'read', '--artifact', transcriptArtifactId])
        )
        expect(artifact.meta).toMatchObject({
          kind: 'log',
          createdBy: 'AttemptSettlement',
          mediaType: 'application/json',
          related: [submission.taskId, submission.attemptId, submission.id]
        })
        const content = Buffer.from(artifact.contentBase64, 'base64').toString('utf8')
        const document = z
          .object({
            type: z.literal('attempt_transcript'),
            version: z.literal(1),
            missionId: z.string(),
            taskId: z.string(),
            attemptId: z.string(),
            submissionId: z.string(),
            source: z.enum(['structured_journal', 'transcript_pin', 'terminal_tail']),
            processesAtSubmission: z.union([
              z.object({ count: z.number(), names: z.array(z.string()) }),
              z.object({ unverifiable: z.string() })
            ])
          })
          .parse(JSON.parse(content))
        expect(document).toMatchObject({
          missionId: mission.id,
          taskId: submission.taskId,
          attemptId: submission.attemptId,
          submissionId: submission.id
        })
        if (submission.taskId === secretTask.task_id) {
          const token = `${'gh' + 'p_'}${'T'.repeat(36)}`
          expect(content.includes(token)).toBe(false)
          expect(content).toContain('[REDACTED]')
        }
      }
      await expect
        .poll(
          () =>
            terminalResources(userData, mission.id).filter(
              (row) => row.release_state === 'released'
            ).length,
          { timeout: 60_000 }
        )
        .toBe(3)
      await expect
        .poll(
          () =>
            inspect().audits.filter((audit) => audit.event === 'attempt.terminal_released').length,
          { timeout: 30_000 }
        )
        .toBe(3)
      for (const submission of submissions) {
        expect(terminalResources(userData, mission.id)).toContainEqual({
          owner_dispatch_id: submission.attemptId,
          release_state: 'released'
        })
        const release = inspect().audits.find(
          (audit) =>
            audit.object_id === submission.attemptId && audit.event === 'attempt.terminal_released'
        )
        expect(JSON.parse(release!.after ?? '{}')).toMatchObject({
          submissionId: submission.id,
          state: 'released',
          processAction: expect.stringMatching(/^(closed_agent_terminal|closed_exited_terminal)$/)
        })
        expect(show(submission.attemptId)).toMatchObject({
          state: 'SUBMITTED',
          workspace: 'released',
          submission: { id: submission.id, transcriptArtifactId: expect.any(String) }
        })
      }
      await expect
        .poll(() => inspect().verification.filter((run) => run.status === 'RUNNING').length, {
          timeout: 60_000
        })
        .toBe(3)
    },
    { holdWorkers: true, releaseTerminals: true }
  )
})
