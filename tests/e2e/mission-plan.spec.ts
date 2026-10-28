import { seedCodexTestAccount } from './helpers/codex-test-account'
import { seedClaudeTestAccount } from './helpers/claude-test-account'
import { createAxiomClaudePlannerStub } from './helpers/axiom-claude-planner-stub'
import {
  AXIOM_TEST_CLAUDE_ENV,
  AXIOM_TEST_CLAUDE_PLANNER_POLICY
} from './helpers/axiom-test-claude-provider'
import { desktopCall } from './helpers/axiom-desktop-call'
import { readGoalFile } from '../../src/cli/handlers/axiom/input-files'
import { DEFAULT_MISSION_POLICY } from '../../src/shared/axiom-contract/mission-objects'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  axiomFixtureRouting,
  configureAxiomFixtureProvider,
  createAxiomFixtureProvider
} from './helpers/axiom-fixture-provider'
import Database from '../../src/main/sqlite/sync-database'
import {
  MissionResponseSchema,
  MissionPlanResponseSchema
} from '../../src/shared/axiom-contract/mission-params'
import { PlanListResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { fixturePlanProposal } from './helpers/fixture-plan-proposal'
import { expectHarnessEgress } from './helpers/harness-egress-expectations'

const FIXTURE_COMMIT = 'a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642'
function git(args: string[]) {
  const result = spawnSync('git', args, {
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    timeout: 30_000
  })
  if (result.error) {
    throw result.error
  }
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}
function invoke(userData: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'out', 'cli', 'index.js'), ...args, '--json'],
    {
      env: {
        ...process.env,
        ORCA_USER_DATA_PATH: userData,
        ORCA_DEV_CLI_INVOCATION: '1',
        ORCA_BACKGROUND_LAUNCH: '1'
      },
      encoding: 'utf8',
      timeout: 130_000
    }
  )
  if (result.error) {
    throw result.error
  }
  return result
}
function cli(userData: string, args: string[]): unknown {
  const result = invoke(userData, args)
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return z.object({ ok: z.literal(true), result: z.unknown() }).parse(JSON.parse(result.stdout))
    .result
}
function inspect(userData: string, missionId: string) {
  const db = new Database(path.join(userData, 'orchestration.db'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    return {
      planners: z
        .array(
          z.object({
            task_id: z.string(),
            dispatch_id: z.string(),
            branch: z.string(),
            state: z.string(),
            release_state: z.string().nullable()
          })
        )
        .parse(
          db
            .prepare(`SELECT b.task_id, b.dispatch_id, b.branch, w.state, r.release_state
        FROM attempt_bindings b JOIN worker_dispatches w ON w.dispatch_id = b.dispatch_id
        LEFT JOIN worker_terminal_resources r ON r.owner_dispatch_id = b.dispatch_id
        WHERE b.mission_id = ? AND b.branch LIKE 'axiom/planner/%'`)
            .all(missionId)
        ),
      audits: z
        .array(z.object({ event: z.string(), object_id: z.string(), after: z.string().nullable() }))
        .parse(
          db
            .prepare(
              'SELECT event, object_id, after FROM audit_events WHERE mission_id = ? ORDER BY sequence'
            )
            .all(missionId)
        )
    }
  } finally {
    db.close()
  }
}
function ledger(file: string) {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) =>
          z
            .object({
              kind: z.string().optional(),
              response: z.object({ ok: z.boolean() }).optional()
            })
            .passthrough()
            .parse(JSON.parse(line))
        )
    : []
}

for (const provider of ['codex', 'claude'] as const) {
  test(
    provider === 'codex'
      ? 'M2-09: a read-only Planner proposes the fixture DAG and releases after PLAN_REVIEW'
      : 'M3-08b: a claude structured Planner proposes the fixture DAG and releases after PLAN_REVIEW',
    async (
      // oxlint-disable-next-line no-empty-pattern -- Restart helper owns the background app lifecycle.
      {},
      testInfo
    ) => {
      test.setTimeout(300_000)
      test.skip(
        provider === 'claude' && process.platform === 'win32',
        'Claude Mission support requires a POSIX host'
      )
      const source = process.env.AXIOM_FIXTURE_REPO
      if (!source) {
        test.skip(true, 'AXIOM_FIXTURE_REPO not set')
        return
      }
      const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-m2-09-'))
      const executable =
        provider === 'claude'
          ? createAxiomClaudePlannerStub(temp)
          : createAxiomFixtureProvider(temp, provider)
      const ledgerPath = path.join(temp, 'planner.jsonl')
      const session = createRestartSession(testInfo, {
        ORCA_BACKGROUND_LAUNCH: '1',
        PATH: `${temp}${path.delimiter}${process.env.PATH ?? ''}`,
        AXIOM_E2E_LEDGER: ledgerPath,
        ORCA_E2E_CLI_ENTRY: path.join(process.cwd(), 'out', 'cli', 'index.js')
      })
      let app: ElectronApplication | undefined
      try {
        const clone = path.join(temp, 'fixture')
        git(['clone', '--no-hardlinks', '--branch', 'main', realpathSync(source), clone])
        expect(git(['-C', clone, 'rev-parse', 'HEAD'])).toBe(FIXTURE_COMMIT)
        expect(git(['-C', clone, 'rev-parse', 'fixture-v1^{commit}'])).toBe(FIXTURE_COMMIT)
        if (provider === 'claude') {
          seedClaudeTestAccount(session.userDataDir)
        } else {
          seedCodexTestAccount(session.userDataDir)
        }
        const first = await session.launch()
        app = first.app
        await waitForSessionReady(first.page)
        await configureAxiomFixtureProvider(first.page, executable, provider)
        const userData = await app.evaluate(({ app }) => app.getPath('userData'))
        const { repo } = z
          .object({ repo: z.object({ id: z.string() }) })
          .parse(cli(userData, ['repo', 'add', '--path', clone]))
        const { mission } = MissionResponseSchema.parse(
          await desktopCall(first.page, 'axiom.mission.create', {
            repo: `id:${repo.id}`,
            targetBranch: 'main',
            goal: await readGoalFile(clone, 'GOAL.md'),
            policy: DEFAULT_MISSION_POLICY
          })
        )
        await desktopCall(first.page, 'axiom.policy.update', {
          missionId: mission.id,
          patch: { routing: axiomFixtureRouting(provider) }
        })
        const cliPlanning = invoke(userData, ['mission', 'plan', '--mission', mission.id])
        expect(cliPlanning.status).not.toBe(0)
        expect(JSON.parse(cliPlanning.stdout)).toMatchObject({
          ok: false,
          error: { code: 'caller_not_desktop' }
        })
        const { attempt } = MissionPlanResponseSchema.parse(
          await desktopCall(first.page, 'axiom.mission.plan', { missionId: mission.id })
        )
        expect(attempt.provider).toBe(provider)
        expect(attempt.branch).toBe(`axiom/planner/${mission.id}/1`)
        await expect
          .poll(
            () =>
              MissionResponseSchema.parse(
                cli(userData, ['mission', 'show', '--mission', mission.id])
              ).mission.status,
            { timeout: 120_000 }
          )
          .toBe('PLAN_REVIEW')
        const { planRevisions } = PlanListResponseSchema.parse(
          cli(userData, ['plan', 'list', '--mission', mission.id])
        )
        expect(planRevisions).toHaveLength(1)
        const plan = planRevisions[0]!
        expect(plan.status).toBe('PROPOSED')
        expect(plan.provenance).toMatchObject({ kind: 'planner', actor: provider })
        expect(plan.tasks).toHaveLength(12)
        expect(plan.edges).toHaveLength(20)
        const incoming = new Set(plan.edges.map((e) => e.toTaskId))
        expect(plan.tasks.filter((t) => !incoming.has(t.id))).toHaveLength(3)
        const expected = fixturePlanProposal(
          JSON.parse(
            readFileSync(path.join(clone, 'scenarios', 'goal', 'decomposition.json'), 'utf8')
          ),
          mission.activeGoalRevisionId!
        )
        expect(plan.tasks).toEqual(expected.tasks)
        expect(plan.edges).toEqual(expected.edges)
        expect(
          TaskListResponseSchema.parse(cli(userData, ['task', 'list', '--mission', mission.id]))
            .tasks
        ).toEqual([])
        await expect
          .poll(
            () => inspect(userData, mission.id).audits.some((a) => a.event === 'planner.stopped'),
            {
              timeout: 120_000
            }
          )
          .toBe(true)
        const settled = inspect(userData, mission.id)
        expect(settled.planners).toHaveLength(1)
        const planner = settled.planners[0]!
        expect(['stopped', 'stop_unknown']).toContain(planner.state)
        expect(settled.audits).toContainEqual(
          expect.objectContaining({ event: 'planner.proposed', object_id: attempt.attemptId })
        )
        if (planner.state === 'stop_unknown') {
          const audit = settled.audits.findLast((a) => a.event === 'planner.stopped')!
          expect(JSON.parse(audit.after!)).toMatchObject({ state: 'stop_unknown' })
        } else {
          await expect
            .poll(() => inspect(userData, mission.id).planners[0]?.release_state, {
              timeout: 120_000
            })
            .toBe('released')
        }
        await expect
          .poll(() => ledger(ledgerPath).find((e) => e.kind === 'proposal')?.response?.ok)
          .toBe(true)
        expect(ledger(ledgerPath).filter((e) => e.kind === 'error')).toEqual([])
        const egressAudit = settled.audits.find(
          (entry) =>
            entry.event === 'attempt.egress_pinned' && entry.object_id === attempt.attemptId
        )
        const egress = JSON.parse(egressAudit?.after ?? 'null')
        if (provider === 'codex' && process.platform !== 'win32') {
          expect(egress).toEqual({
            provider: 'codex',
            channel: 'terminal',
            mode: 'unpinned-terminal',
            noProxy: [],
            blackhole: null,
            overrides: []
          })
        }
        if (provider === 'claude') {
          const settingsPath = path.join(
            userData,
            'axiom',
            'attempts',
            z.string().parse(attempt.attemptId),
            'planner-settings.json'
          )
          const launch = ledger(ledgerPath).find((entry) => entry.kind === 'planner_launch')
          expect(egress).toMatchObject({ provider: 'claude', channel: 'structured' })
          expectHarnessEgress({
            env: launch?.env,
            evidence: egress,
            NO_PROXY: 'api.anthropic.com,platform.claude.com,localhost,127.0.0.1,::1'
          })
          expect(launch).toMatchObject({
            argv: expect.arrayContaining([
              '--settings',
              settingsPath,
              '--setting-sources=',
              '--managed-settings',
              JSON.stringify(AXIOM_TEST_CLAUDE_PLANNER_POLICY),
              '--permission-mode',
              'default'
            ]),
            settingsPath,
            managedSettings: AXIOM_TEST_CLAUDE_PLANNER_POLICY,
            // The pinned SDK sends sources via argv and skills via initialize.
            initialize: { settingSources: null, skills: [] },
            env: {
              ...AXIOM_TEST_CLAUDE_ENV,
              CLAUDE_CONFIG_DIR: path.join(userData, 'claude-profiles', 'e2e-claude', 'home')
            }
          })
          expect(launch?.settings).toEqual({
            syncClaudeAiSkills: false,
            syncClaudeAiPlugins: false,
            enabledPlugins: {},
            permissions: {
              allow: [
                'Read',
                'Grep',
                'Glob',
                'LS',
                'Bash(git log:*)',
                'Bash(git diff:*)',
                'Bash(git show:*)',
                `Bash(axiom plan propose --mission ${mission.id} --attempt ${attempt.attemptId} --file:*)`
              ],
              deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']
            }
          })
          expect(
            settled.audits.filter((entry) => entry.event === 'attempt.permission_denied')
          ).toEqual([])
        }
        const approved = MissionResponseSchema.parse(
          cli(userData, ['mission', 'show', '--mission', mission.id])
        )
        expect(approved.mission.status).toBe('PLAN_REVIEW')
        await desktopCall(first.page, 'axiom.plan.approve', {
          planRevisionId: plan.id,
          resolver: 'e2e'
        })
        expect(
          MissionResponseSchema.parse(cli(userData, ['mission', 'show', '--mission', mission.id]))
            .mission.status
        ).toBe('PLANNED')
        const tasks = TaskListResponseSchema.parse(
          cli(userData, ['task', 'list', '--mission', mission.id])
        ).tasks
        expect(tasks).toHaveLength(12)
        expect(tasks.some((t) => t.id === planner.task_id)).toBe(false)
        await expect(
          desktopCall(first.page, 'axiom.mission.plan', { missionId: mission.id })
        ).rejects.toMatchObject({ code: 'illegal_transition' })
        const denied = invoke(userData, ['mission', 'plan', '--mission', mission.id])
        expect(denied.status).not.toBe(0)
        expect(JSON.parse(denied.stdout)).toMatchObject({
          ok: false,
          error: { code: 'caller_not_desktop' }
        })
        expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(FIXTURE_COMMIT)
      } finally {
        try {
          if (app) {
            await session.close(app)
          }
        } finally {
          try {
            await session.dispose()
          } finally {
            rmSync(temp, { recursive: true, force: true })
          }
        }
      }
    }
  )
}
