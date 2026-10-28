import { seedCodexTestAccount } from './helpers/codex-test-account'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { cli, git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'
import { quotePosixShell } from '../../src/shared/shell-argument-quoting'
import { desktopCall } from './helpers/axiom-desktop-call'
import {
  AXIOM_TEST_CLAUDE_WORKER_POLICY,
  AXIOM_TEST_CLAUDE_DENIED_TOOLS,
  AXIOM_TEST_CLAUDE_MODEL,
  AXIOM_TEST_CLAUDE_VERSION
} from './helpers/axiom-test-claude-provider'
import { AXIOM_T01_FIXTURE_FILES } from './helpers/axiom-t01-fixture'

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

test('M3-08b: a claude headless Worker progresses RUNNING → SUBMITTED → VERIFIED with observed pins', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(600_000)
  const dependencies = realpathSync(path.join(source!, 'node_modules'))
  const dependencyLinks = readdirSync(dependencies)
    .filter((name) => !['.vite', '.vite-temp', '.cache'].includes(name))
    .map(
      (name) =>
        `ln -s ${quotePosixShell(path.join(dependencies, name))} ${quotePosixShell(path.join('node_modules', name))}`
    )
  await withFixtureMission(
    testInfo,
    source!,
    async ({ page, userData, mission, ledgerPath, releaseWorkers, clone }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect
        .poll(() => inspect().tasks.filter((task) => task.stage === 'RUNNING').length, {
          timeout: 120_000
        })
        .toBe(1)
      await expect
        .poll(() => inspect().bindings.filter((row) => row.dispatch_id).length, {
          timeout: 60_000
        })
        .toBe(1)
      const binding = inspect().bindings[0]!
      const attemptId = z.string().parse(binding.dispatch_id)
      const attemptDir = path.join(userData, 'axiom', 'attempts', attemptId)
      await expect.poll(() => existsSync(ledgerPath), { timeout: 60_000 }).toBe(true)
      const launch = z
        .object({
          provider: z.literal('claude'),
          cwd: z.string(),
          attemptId: z.string(),
          argv: z.array(z.string()),
          promptPath: z.string(),
          CLAUDE_CONFIG_DIR: z.string(),
          settings: z.unknown(),
          managedSettings: z.unknown(),
          mcp: z.unknown()
        })
        .parse(JSON.parse(readFileSync(ledgerPath, 'utf8').trim().split('\n')[0]!))
      expect(launch.attemptId).toBe(attemptId)
      expect(launch.CLAUDE_CONFIG_DIR).toBe(
        path.join(userData, 'claude-profiles', 'e2e-claude', 'home')
      )
      expect(launch.promptPath).toBe(path.join(attemptDir, 'prompt.md'))
      expect(launch.argv).toEqual([
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
        '--permission-prompts',
        'none',
        '--setting-sources=',
        '--settings',
        path.join(attemptDir, 'claude-settings.json'),
        '--managed-settings',
        JSON.stringify(AXIOM_TEST_CLAUDE_WORKER_POLICY),
        '--strict-mcp-config',
        '--mcp-config',
        path.join(attemptDir, 'claude-mcp.json'),
        '--disallowedTools',
        AXIOM_TEST_CLAUDE_DENIED_TOOLS.join(','),
        '--model',
        AXIOM_TEST_CLAUDE_MODEL,
        '--effort',
        'medium'
      ])
      expect(launch.managedSettings).toEqual(AXIOM_TEST_CLAUDE_WORKER_POLICY)
      expect(launch.settings).toEqual({
        permissions: {
          allow: [
            'Read',
            'Grep',
            'Glob',
            'LS',
            `Edit(/${launch.cwd}/**)`,
            `Edit(/${attemptDir}/**)`,
            `Write(/${launch.cwd}/**)`,
            `Write(/${attemptDir}/**)`,
            `MultiEdit(/${launch.cwd}/**)`,
            `MultiEdit(/${attemptDir}/**)`,
            `NotebookEdit(/${launch.cwd}/**)`,
            `NotebookEdit(/${attemptDir}/**)`,
            'Bash'
          ],
          deny: AXIOM_TEST_CLAUDE_DENIED_TOOLS
        },
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false },
          filesystem: { allowWrite: [launch.cwd, attemptDir] }
        },
        syncClaudeAiSkills: false,
        syncClaudeAiPlugins: false,
        enabledPlugins: {}
      })
      expect(launch.mcp).toEqual({ mcpServers: {} })
      expect(readFileSync(launch.promptPath, 'utf8')).toContain('CLAUDE.md')
      expect(inspect().submissions).toEqual([])
      // Link provisioned dependencies without installing; keep the parent local so Vite's
      // caches stay in the independent verification worktree rather than the fixture source.
      await desktopCall(page, 'axiom.policy.update', {
        missionId: mission.id,
        patch: {
          verificationRules: {
            setupCommands: ['mkdir node_modules', ...dependencyLinks]
          }
        }
      })
      releaseWorkers()
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
      const submission = inspect().submissions[0]!
      expect(submission.attemptId).toBe(attemptId)
      expect(submission.report.summary).toBe('Frozen fixture T01: Sprint entity and validation')
      expect(submission.report.filesChanged.slice().sort()).toEqual(
        Object.keys(AXIOM_T01_FIXTURE_FILES).sort()
      )
      expect(readFileSync(path.join(attemptDir, 'last-message.md'), 'utf8')).toContain(
        submission.report.summary
      )
      await expect
        .poll(() => inspect().tasks.find((task) => task.task_id === binding.task_id)?.stage, {
          timeout: 480_000
        })
        .toBe('VERIFIED')
      const verified = inspect()
      expect(verified.verification).toHaveLength(1)
      expect(verified.verification[0]).toMatchObject({
        candidateId: submission.candidateId,
        status: 'PASS',
        claimCount: 1,
        verdictDetail: { verdict: 'PASS', diff: { scopeViolations: [] } }
      })
      const stages = verified.audits
        .filter((row) => row.event === 'task.stage' && row.object_id === binding.task_id)
        .map((row) => z.object({ stage: z.string() }).parse(JSON.parse(row.after!)).stage)
      expect(stages.indexOf('RUNNING')).toBeGreaterThanOrEqual(0)
      expect(stages.indexOf('SUBMITTED')).toBeGreaterThan(stages.indexOf('RUNNING'))
      expect(stages.indexOf('VERIFIED')).toBeGreaterThan(stages.indexOf('SUBMITTED'))
      const started = verified.audits.find(
        (row) => row.event === 'attempt.started' && row.object_id === attemptId
      )!
      expect(JSON.parse(started.after!)).toMatchObject({
        channel: 'headless',
        posture: 'headless-sandboxed',
        combination: {
          requested: {
            harness: 'claude',
            channel: 'headless',
            model: AXIOM_TEST_CLAUDE_MODEL,
            effort: 'medium',
            claudeConfigDir: 'selected-account',
            policyTier: 'axiom',
            allowlist: { skills: [], mcpServers: [] },
            launchBaseline: {
              harnessVersion: '2.1.309',
              skills: ['doctor', 'plugin-authoring'],
              evidence: '.axiom-work/verifications/M3-08f-isolation-probe.md'
            },
            settingSources: [],
            syncedSkills: 'off',
            bundledSkills: 'off',
            plugins: 'off',
            mcp: 'strict'
          },
          effective: {
            harnessVersion: expect.stringContaining(AXIOM_TEST_CLAUDE_VERSION),
            claudeConfigDir: { kind: 'account', path: launch.CLAUDE_CONFIG_DIR },
            settingsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            mcpConfigSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            managedSettingsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            accountHome: { surfaces: expect.any(Array) }
          }
        }
      })
      const observed = verified.audits.filter(
        (row) => row.event === 'attempt.launch_observed' && row.object_id === attemptId
      )
      expect(observed).toHaveLength(1)
      expect(JSON.parse(observed[0]!.after!)).toMatchObject({
        harnessVersion: `${AXIOM_TEST_CLAUDE_VERSION} (Claude Code)`,
        model: AXIOM_TEST_CLAUDE_MODEL,
        permissionMode: 'acceptEdits',
        skills: ['doctor', 'plugin-authoring'],
        plugins: [
          { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' }
        ],
        mcpServers: [],
        apiKeySource: 'none'
      })
      const submitted = verified.audits.find(
        (row) => row.event === 'attempt.submitted' && row.object_id === attemptId
      )!
      expect(JSON.parse(submitted.after!)).toMatchObject({
        providerSessionId: `fixture-${attemptId}`,
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25 },
        total_cost_usd: 0.001,
        num_turns: 1,
        permission_denials: []
      })
      expect(
        verified.audits.filter(
          (row) => row.event === 'attempt.launch_mismatch' && row.object_id === attemptId
        )
      ).toEqual([])
      const candidate = verified.candidates.find((row) => row.id === submission.candidateId)!
      expect(git(['-C', clone, 'ls-tree', '-r', '--name-only', candidate.commitSha])).not.toMatch(
        /^\.axiom\//m
      )
    },
    {
      provider: 'claude',
      taskIds: ['T01'],
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 1
    }
  )
})
