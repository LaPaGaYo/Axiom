import { seedCodexTestAccount } from './helpers/codex-test-account'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { cli, git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(
  !source || process.platform === 'win32',
  'Headless Workers require a POSIX host and AXIOM_FIXTURE_REPO'
)

test('three sandboxed exec Workers produce host submissions with Attempt attribution', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  await withFixtureMission(testInfo, source!, async ({ userData, mission, ledgerPath, clone }) => {
    const inspect = () => inspectFixtureMission(userData, mission.id)
    await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(3)
    for (const submission of inspect().submissions) {
      for (const artifactId of submission.report.artifacts) {
        const artifact = ArtifactReadResponseSchema.parse(
          cli(userData, ['mission', 'artifact', 'read', '--artifact', artifactId])
        )
        expect(artifact.meta).toMatchObject({
          createdBy: `attempt:${submission.attemptId}`,
          related: [submission.taskId, submission.attemptId]
        })
      }
      const candidate = inspect().candidates.find((row) => row.id === submission.candidateId)!
      expect(git(['-C', clone, 'ls-tree', '-r', '--name-only', candidate.commitSha])).not.toMatch(
        /^\.axiom\//m
      )
      const audit = inspect().audits.find(
        (row) => row.event === 'attempt.started' && row.object_id === submission.attemptId
      )!
      expect(JSON.parse(audit.after!)).toMatchObject({
        channel: 'headless',
        posture: 'headless-sandboxed',
        combination: { requested: { hooks: 'off' } }
      })
    }
    const launches = readFileSync(ledgerPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((entry) => !entry.kind)
    expect(launches).toHaveLength(3)
    for (const launch of launches) {
      const entry = z
        .object({
          argv: z.array(z.string()),
          promptPath: z.string(),
          CODEX_HOME: z.string().nullable()
        })
        .parse(launch)
      expect(entry.CODEX_HOME).toBe(path.join(userData, 'codex-accounts', 'e2e-codex', 'home'))
      expect(entry.argv.slice(0, 2)).toEqual(['exec', '--json'])
      expect(entry.argv).toEqual(
        expect.arrayContaining([
          '-s',
          'workspace-write',
          'sandbox_workspace_write.network_access=false',
          'features.hooks=false'
        ])
      )
      expect(entry.argv.join(' ')).not.toMatch(/dangerously-bypass|full-auto/)
      expect(entry.promptPath).toContain(path.join(userData, 'axiom', 'attempts'))
    }
  })
})

for (const scenario of ['exit-nonzero', 'bad-report'] as const) {
  test(`${scenario} settles without submission${scenario === 'exit-nonzero' ? ' and retries' : ' with report evidence'}`, async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
  {}, testInfo) => {
    test.setTimeout(300_000)
    await withFixtureMission(
      testInfo,
      source!,
      async ({ userData, mission, ledgerPath, releaseWorkers }) => {
        const inspect = () => inspectFixtureMission(userData, mission.id)
        await expect
          .poll(() => inspect().bindings.filter((row) => row.dispatch_id).length, {
            timeout: 60_000
          })
          .toBe(3)
        // Why poll: a binding gets its dispatch id before the provider appends its ledger line.
        const readLaunches = () =>
          readFileSync(ledgerPath, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .filter((row) => !row.kind)
        await expect.poll(() => readLaunches().length, { timeout: 60_000 }).toBe(3)
        const launches = readLaunches()
        for (const launch of launches) {
          expect(launch.CODEX_HOME).toBe(path.join(userData, 'codex-accounts', 'e2e-codex', 'home'))
        }
        const first = inspect().bindings[0]
        writeFileSync(`${ledgerPath}.scenario-${first.task_id}`, scenario)
        releaseWorkers()
        await expect
          .poll(
            () =>
              inspect().audits.some(
                (row) => row.event === 'attempt.failed' && row.object_id === first.dispatch_id
              ),
            { timeout: 120_000 }
          )
          .toBe(true)
        expect(inspect().submissions.some((row) => row.attemptId === first.dispatch_id)).toBe(false)
        if (scenario === 'exit-nonzero') {
          await expect
            .poll(
              () =>
                inspect().audits.some(
                  (row) =>
                    row.event === 'attempt.terminal_released' &&
                    row.object_id === first.dispatch_id &&
                    JSON.parse(row.after!).reason === 'attempt_failed'
                ),
              { timeout: 60_000 }
            )
            .toBe(true)
          await expect
            .poll(
              () => inspect().submissions.filter((row) => row.taskId === first.task_id).length,
              { timeout: 120_000 }
            )
            .toBe(1)
          expect(
            inspect()
              .bindings.filter((row) => row.task_id === first.task_id)
              .map((row) => row.seq)
          ).toEqual([1, 2])
        } else {
          const event = inspect().audits.find(
            (row) => row.event === 'attempt.failed' && row.object_id === first.dispatch_id
          )!
          expect(JSON.parse(event.after!)).toMatchObject({
            reportError: expect.stringContaining('report'),
            exitCode: 0
          })
        }
      },
      { holdWorkers: true, releaseTerminals: true, maxAttempts: scenario === 'bad-report' ? 1 : 2 }
    )
  })
}

test('restart after the durable exit code creates exactly one submission per Attempt', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  await withFixtureMission(
    testInfo,
    source!,
    async ({ userData, mission, restart }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect
        .poll(
          () =>
            inspect().bindings.filter(
              (row) =>
                row.dispatch_id &&
                existsSync(path.join(userData, 'axiom', 'attempts', row.dispatch_id, 'exit-code'))
            ).length,
          { timeout: 120_000 }
        )
        .toBe(3)
      expect(inspect().submissions).toHaveLength(0)
      const ids = inspect()
        .bindings.map((row) => row.dispatch_id)
        .sort()
      await restart!()
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(3)
      expect(
        inspect()
          .submissions.map((row) => row.attemptId)
          .sort()
      ).toEqual(ids)
      await restart!()
      expect(
        inspect()
          .submissions.map((row) => row.attemptId)
          .sort()
      ).toEqual(ids)
      expect(inspect().audits.filter((row) => row.event === 'attempt.submitted')).toHaveLength(3)
    },
    { restart: true, holdExitSubmission: true }
  )
})

test('a retry resolves the selected account and pins its home in the Worker wrapper', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  await withFixtureMission(
    testInfo,
    source!,
    async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect
        .poll(() => inspect().bindings.filter((row) => row.dispatch_id).length, { timeout: 60_000 })
        .toBe(3)
      const first = inspect().bindings[0]
      const { homePath: managedHomePath, settings } = seedCodexTestAccount(userData, {
        accountId: 'e2e-headless-home',
        persistSettings: false
      })
      await page.evaluate(async (settings) => {
        await window.__store!.getState().updateSettings(settings)
      }, settings)
      // The first Attempt was already prepared; its retry must read the new account selection.
      writeFileSync(`${ledgerPath}.scenario-${first.task_id}`, 'exit-nonzero')
      releaseWorkers()
      await expect
        .poll(() => inspect().submissions.filter((row) => row.taskId === first.task_id).length, {
          timeout: 120_000
        })
        .toBe(1)
      const submission = inspect().submissions.find((row) => row.taskId === first.task_id)!
      const launch = readFileSync(ledgerPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .find((row) => !row.kind && row.attemptId === submission.attemptId)
      expect(launch.CODEX_HOME).toBe(managedHomePath)
      const started = inspect().audits.find(
        (row) => row.event === 'attempt.started' && row.object_id === submission.attemptId
      )!
      expect(JSON.parse(started.after!)).toMatchObject({
        combination: {
          requested: { hooks: 'off', codexHome: 'selected-account' },
          effective: {
            harnessVersion: 'codex-cli 0.0.0-e2e',
            codexHome: { kind: 'account', path: managedHomePath },
            configSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            token: 'not_applicable'
          }
        }
      })
    },
    { holdWorkers: true, maxAttempts: 2 }
  )
})

test('no Codex account refuses admission without launching a Worker', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(120_000)
  await withFixtureMission(
    testInfo,
    source!,
    async ({ userData, mission, ledgerPath }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect
        .poll(() => inspect().audits.some((row) => row.event === 'task.admission_refused'), {
          timeout: 30_000
        })
        .toBe(true)
      const event = inspect().audits.find((row) => row.event === 'task.admission_refused')!
      expect(JSON.parse(event.after!).filtered).toContainEqual({
        provider: 'codex',
        reason: 'no_account'
      })
      expect(inspect().bindings).toHaveLength(0)
      expect(existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').trim() : '').toBe('')
      const { tasks } = TaskListResponseSchema.parse(
        cli(userData, ['task', 'list', '--mission', mission.id])
      )
      expect(tasks.some((task) => task.stage === 'RUNNING')).toBe(false)
    },
    { noCodexAccount: true }
  )
})
