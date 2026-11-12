import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { SupervisionShowResponse } from '../../src/shared/axiom-contract/supervision'
import { AttemptPreservedAuditSchema } from '../../src/main/axiom/execution/preserved-snapshot-contract'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires a POSIX host and AXIOM_FIXTURE_REPO')
const Stopped = z.object({ reason: z.string() })
const Supervised = z.object({
  rule: z.literal('stalled'),
  mode: z.literal('stop'),
  action: z.enum(['stopped', 'stop_unknown']),
  thresholdMs: z.number(),
  thresholdSource: z.enum(['measured', 'default', 'e2e']),
  idleMs: z.number()
})
const Cadence = z.object({ samples: z.number().int().positive() })
const FirstLaunch = z.object({ seq: z.number(), branch: z.string() })
const ContinuedLaunch = z.object({
  seq: z.number(),
  baseline: z.object({
    kind: z.string(),
    strategy: z.string(),
    reason: z.string(),
    previousSeq: z.number(),
    attemptId: z.string(),
    commitSha: z.string()
  })
})

test('M3-06-3-2: a stall-stopped Attempt continues automatically from its preserved work', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  if (!source) {
    throw new Error('Missing fixture repository')
  }
  test.setTimeout(300_000)
  const partial = 'src/services/stall-partial.ts'
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, userData, mission, ledgerPath, clone, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().tasks[0]?.task_id)
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
      writeFileSync(`${ledgerPath}.stall-${taskId}`, '')
      writeFileSync(`${ledgerPath}.partial-${taskId}`, partial)
      const updated = SupervisionShowResponse.parse(
        await desktopCall(page, 'axiom.supervision.update', {
          rule: 'stalled',
          missionId: mission.id,
          mode: 'stop'
        })
      )
      const shown = SupervisionShowResponse.parse(
        await desktopCall(page, 'axiom.supervision.show', { missionId: mission.id })
      )
      for (const view of [updated, shown]) {
        expect(view).toEqual({
          rules: [
            {
              rule: 'stalled',
              globalMode: 'observe',
              globalSource: 'built_in',
              missionMode: 'stop',
              effectiveMode: 'stop'
            }
          ],
          notifications: []
        })
      }
      releaseWorkers()
      // The runtime owns stop, recovery and retry. All observations below are read-only.
      await expect
        .poll(() => inspect().audits.some(({ event }) => event === 'attempt.stopped'), {
          timeout: 150_000
        })
        .toBe(true)
      const stoppedState = inspect()
      const stopped = stoppedState.audits.find(({ event }) => event === 'attempt.stopped')
      if (!stopped) {
        throw new Error('Missing stopped Attempt audit')
      }
      const firstAttemptId = stopped.object_id
      expect(Stopped.parse(JSON.parse(stopped.after ?? '{}')).reason).toBe('stalled')
      const supervised = stoppedState.audits
        .filter(
          ({ event, object_id }) => event === 'attempt.supervised' && object_id === firstAttemptId
        )
        .map((audit) => ({ ...audit, after: Supervised.parse(JSON.parse(audit.after ?? '{}')) }))
      expect(supervised).toHaveLength(1)
      const supervision = supervised[0]
      if (!supervision) {
        throw new Error('Missing stall stop audit')
      }
      expect(supervision.after).toMatchObject({
        rule: 'stalled',
        mode: 'stop',
        action: 'stopped',
        thresholdMs: 1000,
        thresholdSource: 'e2e'
      })
      expect(supervision.after.idleMs).toBeGreaterThanOrEqual(1000)
      expect(supervision.sequence).toBeLessThan(stopped.sequence)
      const preservation = stoppedState.audits.find(
        ({ event, object_id }) => event === 'attempt.preserved' && object_id === firstAttemptId
      )
      const evidence = AttemptPreservedAuditSchema.parse(JSON.parse(preservation?.after ?? '{}'))
      expect(evidence.taskId).toBe(taskId)
      expect(evidence.result).toMatchObject({
        status: 'preserved',
        scopePaths: [partial],
        secrets: []
      })
      if (evidence.result.status !== 'preserved') {
        throw new Error('Stopped Attempt work was not preserved')
      }
      const { snapshot } = evidence.result
      expect(git(['-C', clone, 'rev-parse', snapshot.ref])).toBe(snapshot.commitSha)
      const firstStart = stoppedState.audits.find(
        ({ event, object_id }) => event === 'attempt.started' && object_id === firstAttemptId
      )
      const firstLaunch = FirstLaunch.parse(JSON.parse(firstStart?.after ?? '{}'))
      expect(firstLaunch.seq).toBe(1)
      const worktree = git(['-C', clone, 'worktree', 'list', '--porcelain'])
        .split('\n\n')
        .map((record) => record.split('\n'))
        .find((fields) => fields.includes(`branch refs/heads/${firstLaunch.branch}`))
        ?.find((field) => field.startsWith('worktree '))
        ?.slice('worktree '.length)
      if (!worktree) {
        throw new Error('Missing stopped Attempt worktree')
      }
      expect(readFileSync(path.join(worktree, partial), 'utf8')).toContain('partialWork = true')
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
      const successorState = inspect()
      const submission = successorState.submissions[0]
      const candidate = successorState.candidates.find(({ id }) => id === submission?.candidateId)
      if (!submission || !candidate) {
        throw new Error('Missing successor Submission or Candidate')
      }
      expect(submission.taskId).toBe(taskId)
      expect(submission.attemptId).not.toBe(firstAttemptId)
      expect(candidate.attemptId).toBe(submission.attemptId)
      const started = successorState.audits.find(
        ({ event, object_id }) => event === 'attempt.started' && object_id === submission.attemptId
      )
      expect(ContinuedLaunch.parse(JSON.parse(started?.after ?? '{}'))).toEqual({
        seq: 2,
        baseline: {
          kind: 'snapshot',
          strategy: 'continued',
          reason: 'preserved_snapshot',
          previousSeq: 1,
          attemptId: firstAttemptId,
          commitSha: snapshot.commitSha
        }
      })
      const prompt = readFileSync(
        path.join(userData, 'axiom', 'attempts', submission.attemptId, 'prompt.md'),
        'utf8'
      )
      for (const text of [
        snapshot.commitSha,
        partial,
        'I left partial work for the next Attempt to review.',
        // The section quotes a command as one JSON string, so its inner quotes arrive escaped.
        JSON.stringify(`git status --short -- "${partial}"`),
        'stalled'
      ]) {
        expect(prompt).toContain(text)
      }
      expect(
        git(['-C', clone, 'ls-tree', '-r', '--name-only', candidate.commitSha]).split('\n')
      ).toContain(partial)
      const cadences = () =>
        inspect().audits.filter(
          ({ event, object_id }) => event === 'attempt.cadence' && object_id === firstAttemptId
        )
      await expect.poll(() => cadences().length).toBe(1)
      expect(
        Cadence.parse(JSON.parse(cadences()[0]?.after ?? '{}')).samples
      ).toBeGreaterThanOrEqual(1)
    },
    {
      provider: 'codex',
      taskIds: ['T01'],
      holdWorkers: true,
      maxAttempts: 2,
      stallThresholdMs: 1000,
      extraAllowedPaths: [partial],
      runVerification: false
    }
  )
})
