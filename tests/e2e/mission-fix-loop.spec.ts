import { desktopCall } from './helpers/axiom-desktop-call'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { cli, git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { VerificationListResponseSchema } from '../../src/shared/axiom-contract/verification-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'
import { quotePosixShell } from '../../src/shared/shell-argument-quoting'

test('M3-04b-2: Attempt 3 names a failed criterion and a finding persisting since Attempt 1', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(240_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires POSIX fixture host')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-acceptance-persistence-'))
  const checkPath = path.join(temp, 'persistence-check.cjs')
  const command = `node ${quotePosixShell(checkPath)}`
  const criterion = 'The persistence probe passes'
  const failure = 'tests/e2e/mission-fix-loop.spec.ts > persistence probe'
  try {
    await withFixtureMission(
      testInfo,
      source,
      async ({ userData, mission, ledgerPath, releaseWorkers }) => {
        const inspect = () => inspectFixtureMission(userData, mission.id)
        await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
        const taskId = z.string().parse(inspect().bindings[0]?.task_id)
        writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'deterministic-failure')
        // The frozen scenario applies candidate.patch then fix.patch unchanged. This external
        // verification probe supplies a repeatable finding solely to exercise context persistence.
        // Hold the third Worker with the existing ledger gate before it can reapply fix.patch.
        writeFileSync(
          checkPath,
          `const { existsSync, writeFileSync } = require('node:fs')
const firstCheck = ${JSON.stringify(path.join(temp, 'first-check'))}
if (existsSync(firstCheck)) writeFileSync(${JSON.stringify(`${ledgerPath}.hold`)}, '')
else writeFileSync(firstCheck, '')
console.error(${JSON.stringify(`FAIL ${failure}`)})
process.exit(1)
`
        )
        releaseWorkers()
        await expect
          .poll(() => inspect().verification.filter((run) => run.status === 'FAIL').length, {
            timeout: 120_000
          })
          .toBe(2)
        await expect
          .poll(() => inspect().bindings.find((binding) => binding.seq === 3)?.dispatch_id, {
            timeout: 60_000
          })
          .toBeTruthy()
        const persisted = inspect()
        expect(persisted.bindings.map((binding) => binding.seq)).toEqual([1, 2, 3])
        expect(persisted.verification).toHaveLength(2)
        for (const run of persisted.verification) {
          expect(run.verdictDetail).toMatchObject({
            verdict: 'FAIL',
            reason: 'checks_failed',
            acceptance: [
              {
                index: 0,
                text: criterion,
                check: { kind: 'command', command },
                result: 'fail',
                checkIndexes: [0],
                artifactIds: []
              }
            ],
            checks: [expect.objectContaining({ result: 'fail', failures: [failure] })]
          })
        }
        const third = z
          .string()
          .parse(persisted.bindings.find((binding) => binding.seq === 3)?.dispatch_id)
        const promptPath = path.join(userData, 'axiom', 'attempts', third, 'prompt.md')
        await expect.poll(() => existsSync(promptPath)).toBe(true)
        const prompt = readFileSync(promptPath, 'utf8')
        expect(prompt).toContain(`[fail] ${JSON.stringify(criterion)}`)
        expect(prompt).toContain(`${JSON.stringify(failure)} (persisting since Attempt 1)`)
        expect(prompt).not.toContain('Not yet demonstrated')
        await expect
          .poll(
            () => fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'submission').length
          )
          .toBe(2)
        expect(fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'error')).toEqual([])
      },
      {
        taskIds: ['T01'],
        holdWorkers: true,
        runVerification: true,
        maxAttempts: 3,
        extraAllowedPaths: ['src/domain/recurrence.ts'],
        acceptanceCriteria: [{ text: criterion, check: { kind: 'command', command } }]
      }
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('M3-04: failed Candidates continue with evidence, two fixes verify and repeated scope violations exhaust retries', async (// oxlint-disable-next-line no-empty-pattern -- Fixture helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(900_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, mission, clone, userData, ledgerPath, temp, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const list = () =>
        VerificationListResponseSchema.parse(
          cli(userData, ['verification', 'list', '--mission', mission.id])
        ).runs
      await expect
        .poll(() => inspect().tasks.filter((task) => task.stage === 'RUNNING').length, {
          timeout: 60_000
        })
        .toBe(3)
      const roots = inspect().tasks.filter((task) => task.stage === 'RUNNING')
      const assignments = [
        {
          id: 'T01',
          scenario: 'deterministic-failure',
          final: 'PASS',
          stage: 'VERIFIED',
          failure:
            'src/domain/recurrence.test.ts > advances daily, weekly, interval and clamped monthly dates'
        },
        {
          id: 'T02',
          scenario: 'retry',
          final: 'PASS',
          stage: 'VERIFIED',
          failure:
            'src/services/date-range.test.ts > dateRange accepts inclusive and optional boundaries'
        },
        { id: 'T03', scenario: 'scope-violation', final: 'FAIL', stage: 'BLOCKED', failure: null }
      ].map((scenario) => {
        const task = roots.find(
          (root) => z.object({ id: z.string() }).parse(JSON.parse(root.spec)).id === scenario.id
        )
        if (!task) {
          throw new Error(`Missing fixture Task ${scenario.id}`)
        }
        writeFileSync(`${ledgerPath}.scenario-${task.task_id}`, scenario.scenario)
        return { ...scenario, taskId: task.task_id }
      })
      const rulesFile = path.join(temp, 'verification-rules.json')
      writeFileSync(
        rulesFile,
        JSON.stringify({ setupCommands: ['pnpm install --frozen-lockfile --prefer-offline'] })
      )
      await desktopCall(page, 'axiom.policy.update', {
        missionId: mission.id,
        patch: { verificationRules: JSON.parse(readFileSync(rulesFile, 'utf8')) }
      })
      releaseWorkers()
      await expect
        .poll(() => list().filter((run) => ['PASS', 'FAIL'].includes(run.status)).length, {
          timeout: 780_000
        })
        .toBe(6)
      await expect
        .poll(() => list().filter((run) => run.worktreeId === null).length, { timeout: 30_000 })
        .toBe(6)
      const runs = list()
      expect(runs).toHaveLength(6)
      const persisted = inspect()
      expect(persisted.bindings).toHaveLength(6)
      const tasks = TaskListResponseSchema.parse(
        cli(userData, ['task', 'list', '--mission', mission.id])
      ).tasks
      for (const expected of assignments) {
        const bindings = persisted.bindings.filter((binding) => binding.task_id === expected.taskId)
        expect(bindings.map((binding) => binding.seq)).toEqual([1, 2])
        const candidates = bindings.map((binding) => {
          const candidate = persisted.candidates.find(
            (row) => row.attemptId === binding.dispatch_id
          )
          if (!candidate) {
            throw new Error(`Missing Candidate for ${expected.id}/${binding.seq}`)
          }
          return candidate
        })
        const [first, second] = candidates
        const firstRun = runs.find((run) => run.candidateId === first.id)!
        const secondRun = runs.find((run) => run.candidateId === second.id)!
        expect(firstRun.status).toBe('FAIL')
        expect(secondRun.status).toBe(expected.final)
        expect(first.status).toBe('SUPERSEDED')
        expect(second.status).toBe('ACTIVE')
        expect(git(['-C', clone, 'rev-parse', `${second.commitSha}^`])).toBe(first.commitSha)
        const launch = persisted.audits.find(
          (audit) =>
            audit.event === 'attempt.started' && audit.object_id === bindings[1].dispatch_id
        )
        expect(launch).toBeDefined()
        expect(JSON.parse(launch!.after!)).toMatchObject({
          taskId: expected.taskId,
          seq: 2,
          orcaTaskReopened: true,
          baseline: { kind: 'candidate', candidateId: first.id, commitSha: first.commitSha }
        })
        const context = persisted.contextPackages.find(
          (row) => row.id === bindings[1].context_package_id
        )
        if (!context) {
          throw new Error(`Missing fix ContextPackage for ${expected.id}`)
        }
        const renderId = z.array(z.string()).parse(JSON.parse(context.mandatory_refs))[1]
        const artifact = ArtifactReadResponseSchema.parse(
          cli(userData, ['mission', 'artifact', 'read', '--artifact', renderId])
        )
        const render = Buffer.from(artifact.contentBase64, 'base64').toString('utf8')
        expect(render).toContain(
          `This Attempt continues the previous Candidate ${first.commitSha} from Attempt 1`
        )
        if (expected.failure) {
          const checks = z
            .array(z.object({ result: z.string(), failures: z.array(z.string()) }))
            .parse(firstRun.verdictDetail.checks)
          expect(
            checks.filter((check) => check.result === 'fail').flatMap((check) => check.failures)
          ).toContain(expected.failure)
          expect(render).toContain(expected.failure)
        } else {
          for (const run of [firstRun, secondRun]) {
            expect(run.verdictDetail).toMatchObject({
              reason: 'scope_violation',
              diff: { scopeViolations: ['README.md'] }
            })
          }
          expect(render).toContain('README.md')
          expect(render).toContain('Remove or revert these paths')
        }
        expect(tasks.find((task) => task.id === expected.taskId)?.stage).toBe(expected.stage)
        const stages = persisted.audits
          .filter((audit) => audit.event === 'task.stage' && audit.object_id === expected.taskId)
          .map((audit) =>
            z
              .object({ stage: z.string(), reason: z.string() })
              .parse(JSON.parse(audit.after ?? '{}'))
          )
        expect(stages).toContainEqual({ stage: 'NEEDS_FIX', reason: 'verification_failed' })
        expect(stages).toContainEqual({ stage: 'READY', reason: 'retry' })
        if (expected.stage === 'BLOCKED') {
          expect(stages.slice(-2)).toEqual([
            { stage: 'NEEDS_FIX', reason: 'verification_failed' },
            { stage: 'BLOCKED', reason: 'retry_budget_exhausted' }
          ])
        } else {
          expect(stages.at(-1)).toEqual({ stage: 'VERIFIED', reason: 'verification_passed' })
        }
      }
      await expect
        .poll(() => fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'submission').length)
        .toBe(6)
      expect(fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'error')).toEqual([])
    },
    {
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 2,
      extraAllowedPaths: [
        'src/domain/recurrence.ts',
        'src/services/date-range.ts',
        'src/services/date-range.test.ts'
      ]
    }
  )
})
