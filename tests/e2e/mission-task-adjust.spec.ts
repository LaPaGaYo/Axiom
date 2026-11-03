import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { MessageListResponseSchema } from '../../src/shared/axiom-contract/message-params'
import { TaskResponseSchema } from '../../src/shared/axiom-contract/task-params'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(
  !source || process.platform === 'win32',
  'Headless Workers require a POSIX host and AXIOM_FIXTURE_REPO'
)
const testPath = 'src/services/date-range.test.ts'
// Frozen S4 patch 2 moves the empty entityId example to the rejected list; Node alone proves it.
const check = `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId: \\'\\' }, { from') ? 0 : 1)"`
const cases = [
  { scenario: 'blocked-scope', maxAttempts: 3 },
  { scenario: 'blocked-scope', maxAttempts: 2 },
  { scenario: 'no-change-declared', maxAttempts: 3 }
] as const
for (const { scenario, maxAttempts } of cases) {
  test(`M3-04b: ${scenario}, budget ${maxAttempts}, human adjustment continues the Candidate`, async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
  {}, testInfo) => {
    test.setTimeout(300_000)
    await withFixtureMission(
      testInfo,
      source!,
      async (fixture) => {
        let page = fixture.page
        const { userData, mission, ledgerPath, releaseWorkers, restart } = fixture
        const inspect = () => inspectFixtureMission(userData, mission.id)
        const disputed = scenario === 'no-change-declared'
        const reason = disputed ? 'candidate_already_correct' : 'blocked_by_scope'
        await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
        const taskId = inspect().bindings[0]!.task_id
        writeFileSync(`${ledgerPath}.scenario-${taskId}`, scenario)
        releaseWorkers()
        await expect
          .poll(() => inspect().bindings.find((row) => row.seq === 2)?.dispatch_id, {
            timeout: 120_000
          })
          .toBeTruthy()
        const second = z
          .string()
          .parse(inspect().bindings.find((row) => row.seq === 2)?.dispatch_id)
        const exitFile = path.join(userData, 'axiom', 'attempts', second, 'exit-code')
        await expect.poll(() => existsSync(exitFile), { timeout: 60_000 }).toBe(true)
        expect(readFileSync(exitFile, 'utf8').trim()).toBe('0')
        await expect
          .poll(
            () =>
              inspect().audits.some(
                (row) => row.event === 'attempt.failed' && row.object_id === second
              ),
            { timeout: 30_000 }
          )
          .toBe(true)
        const failures = inspect().audits.filter(
          (row) => row.event === 'attempt.failed' && row.object_id === second
        )
        expect(failures).toHaveLength(1)
        const first = inspect().bindings.find((row) => row.seq === 1)!
        const candidate = inspect().submissions.find(
          (row) => row.attemptId === first.dispatch_id
        )!.candidateId
        expect(JSON.parse(failures[0]!.after!)).toMatchObject({
          reason: 'process_exited',
          evidence: 'exit_code',
          exitCode: 0,
          settlement: {
            kind: disputed ? 'no_change' : 'blocked',
            reason,
            ...(disputed ? {} : { paths: [testPath] })
          },
          candidate: { id: candidate },
          reportArtifactId: expect.any(String),
          worktreeChanged: expect.any(Number)
        })
        expect(inspect().tasks[0]!.stage).toBe('BLOCKED')
        const stages = () =>
          inspect()
            .audits.filter((row) => row.event === 'task.stage' && row.object_id === taskId)
            .map((row) => JSON.parse(row.after!))
        expect(stages().slice(-2)).toMatchObject([
          { stage: 'NEEDS_FIX', reason: disputed ? 'attempt_no_change' : 'attempt_blocked' },
          { stage: 'BLOCKED', reason: disputed ? 'candidate_disputed' : 'scope' }
        ])
        const pending = async () =>
          MessageListResponseSchema.parse(
            await desktopCall(page, 'axiom.message.list', {
              missionId: mission.id,
              pendingOnly: true
            })
          ).messages
        const messages = await pending()
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
          type: 'BLOCKED',
          taskId,
          attemptId: second,
          pending: true,
          blocked: { reason, paths: disputed ? [] : [testPath] }
        })
        expect(inspect().verification.map((run) => run.status)).toEqual(['FAIL'])
        expect(inspect().submissions).toHaveLength(1)
        expect(inspect().candidates).toHaveLength(1)
        // A declaration must hold across normal scheduling, even with retries remaining.
        await page.waitForTimeout(15_000)
        expect(inspect().bindings.map((row) => row.seq)).toEqual([1, 2])
        const rationale = disputed
          ? 'Reviewed the disputed verdict; continue the Candidate.'
          : 'The failing fixture check requires this test path.'
        const params = { taskId, rationale, ...(disputed ? {} : { addAllowedPaths: [testPath] }) }
        if (maxAttempts === 2) {
          page = await restart!()
          expect(inspect().tasks[0]!.stage).toBe('BLOCKED')
          expect(inspect().bindings.map((row) => row.seq)).toEqual([1, 2])
          const before = inspect()
          await expect(desktopCall(page, 'axiom.task.adjust', params)).rejects.toMatchObject({
            code: 'retry_budget_exhausted'
          })
          expect(inspect().tasks).toEqual(before.tasks)
          expect(
            inspect().audits.filter((row) =>
              ['task.adjusted', 'blocked.resolved'].includes(row.event)
            )
          ).toEqual([])
          expect((await pending()).map((row) => row.id)).toEqual(messages.map((row) => row.id))
        }
        const adjusted = TaskResponseSchema.parse(
          await desktopCall(page, 'axiom.task.adjust', {
            ...params,
            ...(maxAttempts === 2 ? { maxAttempts: 3 } : {})
          })
        ).task
        expect(adjusted.stage).toBe('READY')
        const shown = TaskResponseSchema.parse(
          await desktopCall(page, 'axiom.task.show', { taskId })
        ).task
        // Admission is scheduled by adjust; the next RPC can already observe legitimate progress.
        expect(['READY', 'RUNNING', 'SUBMITTED', 'VERIFYING', 'VERIFIED']).toContain(shown.stage)
        expect(await pending()).toEqual([])
        const adjustedAudits = inspect().audits
        expect(adjustedAudits.filter((row) => row.event === 'task.adjusted')).toHaveLength(1)
        expect(adjustedAudits.filter((row) => row.event === 'plan.minor_adjustment')).toHaveLength(
          1
        )
        const resolved = adjustedAudits.filter((row) => row.event === 'blocked.resolved')
        expect(resolved).toHaveLength(1)
        expect(resolved[0]!.object_id).toBe(messages[0]!.id)
        expect(JSON.parse(resolved[0]!.after!)).toMatchObject({
          decision: 'adjusted',
          taskId,
          rationale
        })
        expect(stages().filter((row) => row.reason === 'adjusted')).toMatchObject([
          { stage: 'NEEDS_FIX', reason: 'adjusted' },
          { stage: 'READY', reason: 'adjusted' }
        ])
        await expect.poll(() => inspect().tasks[0]!.stage, { timeout: 120_000 }).toBe('VERIFIED')
        const third = z.string().parse(inspect().bindings.find((row) => row.seq === 3)?.dispatch_id)
        const started = inspect().audits.find(
          (row) => row.event === 'attempt.started' && row.object_id === third
        )!
        expect(JSON.parse(started.after!)).toMatchObject({
          baseline: { kind: 'candidate', candidateId: candidate }
        })
        const prompt = readFileSync(
          path.join(userData, 'axiom', 'attempts', third, 'prompt.md'),
          'utf8'
        )
        expect(prompt).toContain(
          disputed
            ? 'Attempt 2 declared no_change (candidate_already_correct)'
            : 'Attempt 2 declared blocked_by_scope'
        )
        expect(prompt).toContain(testPath)
        expect(prompt).toContain('A human adjusted this Task after Attempt 2')
        expect(
          inspect()
            .verification.map((run) => run.status)
            .sort()
        ).toEqual(['FAIL', 'PASS'])
        expect(inspect().bindings.map((row) => row.seq)).toEqual([1, 2, 3])
      },
      {
        taskIds: ['T01'],
        holdWorkers: true,
        runVerification: true,
        releaseTerminals: true,
        restart: maxAttempts === 2,
        maxAttempts,
        // This case isolates verdict review; scope-blocked cases authorize the test only through adjust.
        extraAllowedPaths: [
          'src/services/date-range.ts',
          ...(scenario === 'no-change-declared' ? [testPath] : [])
        ],
        acceptanceCriteria: [
          {
            text: 'The date-range contract rejects an empty entityId',
            check: { kind: 'command', command: check }
          }
        ]
      }
    )
  })
}
