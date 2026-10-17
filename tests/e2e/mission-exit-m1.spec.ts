/**
 * M1 exit on D42's frozen Controlled Acceptance Fixture. The sole permitted
 * skip is AXIOM_FIXTURE_REPO unset; a missing path/tag or wrong commit fails.
 * Clone a local main without hardlinks, never fetch; CLI targets the launched
 * app. SQLite inspection is read-only. Electron stays windowless on both boots.
 * §4b's complete intercept coverage belongs to src/main/axiom/admission/*.test.ts.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { fixturePlanProposal } from './helpers/fixture-plan-proposal'
import Database from '../../src/main/sqlite/sync-database'
import { MissionResponseSchema } from '../../src/shared/axiom-contract/mission-params'
import { GoalResponseSchema } from '../../src/shared/axiom-contract/goal-params'
import { PlanResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'

const FIXTURE_COMMIT = 'a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642'
const READY_TITLES = [
  'Sprint entity and validation',
  'Tabular CSV interchange',
  'Ready work planning report'
].sort()

function git(args: string[]): string {
  const result = spawnSync('git', args, {
    // Only the local file protocol is allowed, even if Git has URL rewrites configured.
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

function invokeCompiledCli(userData: string, args: string[]) {
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
      timeout: 30_000
    }
  )
  if (result.error) {
    throw result.error
  }
  expect(result.signal, args.join(' ')).toBeNull()
  expect(result.status, args.join(' ')).not.toBeNull()
  return { ...result, json: JSON.parse(result.stdout) }
}

function cli(userData: string, args: string[]): unknown {
  const result = invokeCompiledCli(userData, args)
  expect(result.status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`).toBe(0)
  return z.object({ ok: z.literal(true), result: z.unknown() }).parse(result.json).result
}

function inspectMission(userData: string, missionId: string) {
  const db = new Database(path.join(userData, 'orchestration.db'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    return {
      binding: z
        .object({ run_id: z.string(), status: z.string() })
        .parse(db.prepare('SELECT run_id, status FROM missions WHERE id = ?').get(missionId)),
      lostBindings: db
        .prepare('SELECT actor, event FROM audit_events WHERE mission_id = ? AND event = ?')
        .all(missionId, 'recovery.run_binding_lost')
    }
  } finally {
    db.close()
  }
}

function snapshot(userData: string, missionId: string) {
  const mission = cli(userData, ['mission', 'show', '--mission', missionId])
  const { activeGoalRevisionId, activePlanRevisionId } =
    MissionResponseSchema.parse(mission).mission
  if (!activeGoalRevisionId || !activePlanRevisionId) {
    throw new Error('Missing active revisions')
  }
  const goal = cli(userData, [
    'mission',
    'goal',
    'show',
    '--mission',
    missionId,
    '--goal',
    activeGoalRevisionId
  ])
  const plan = cli(userData, ['plan', 'show', '--plan', activePlanRevisionId])
  const tasks = cli(userData, ['task', 'list', '--mission', missionId])
  GoalResponseSchema.parse(goal)
  PlanResponseSchema.parse(plan)
  TaskListResponseSchema.parse(tasks)
  // Byte comparison of complete result payloads, excluding changing RPC envelope ids.
  return { mission, goal, plan, tasks }
}

async function missionUi(page: Page, missionId: string, goal: string) {
  await waitForSessionReady(page)
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store unavailable')
    }
    store.getState().openMissionsPage()
  })
  await expect(page.getByRole('heading', { name: 'Missions', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh Missions' }).click()
  await page
    .getByRole('navigation', { name: 'Mission list' })
    .getByRole('button')
    .filter({ hasText: missionId })
    .click()
  await expect(page.getByRole('heading', { name: 'Mission Home', exact: true })).toBeVisible()
  await expect(page.locator('[data-mission-status]')).toHaveText('Executing')
  await expect(page.getByRole('region', { name: 'Mission Home' })).toContainText(goal)
  const table = page.getByRole('table', { name: 'Tasks', exact: true })
  await expect(table.locator('tbody tr')).toHaveCount(12)
  await expect(table.locator('[data-task-stage="READY"]')).toHaveText(['Ready', 'Ready', 'Ready'])
  await expect(table.locator('[data-task-stage="DEFINED"]')).toHaveCount(9)
  await expect(table.getByText('Execution projection: ready', { exact: true })).toHaveCount(12)
  await expect(table).not.toContainText(/\bdone\b|completed/i)
  await expect(page.getByTestId('mission-progress')).toHaveText('0 / 12 Tasks integrated')
  return {
    home: await page.getByRole('region', { name: 'Mission Home' }).innerText(),
    rows: await table.locator('tbody tr').allTextContents()
  }
}

test('M1 exit: frozen fixture survives restart and refuses direct Orca mutations', async (// oxlint-disable-next-line no-empty-pattern -- Restart session owns both launches; no default app fixture.
{}, testInfo) => {
  test.setTimeout(300_000)
  const fixtureSource = process.env.AXIOM_FIXTURE_REPO
  if (!fixtureSource) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-m1-exit-'))
  const session = createRestartSession(testInfo, { ORCA_BACKGROUND_LAUNCH: '1' })
  let app: ElectronApplication | undefined
  const started = performance.now()
  const durationsMs: Record<string, number> = {}
  const refusals: Record<string, string> = {}
  try {
    const clone = path.join(temp, 'fixture')
    git(['clone', '--no-hardlinks', '--branch', 'main', realpathSync(fixtureSource), clone])
    const head = git(['-C', clone, 'rev-parse', 'HEAD'])
    expect(head, 'Fixture main must still be fixture-v1 (D42)').toBe(
      git(['-C', clone, 'rev-parse', 'fixture-v1^{commit}'])
    )
    expect(head, 'Frozen fixture commit (D42)').toBe(FIXTURE_COMMIT)
    durationsMs.cloneAndIdentity = performance.now() - started
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    const setupStarted = performance.now()
    const { repo } = z
      .object({ repo: z.object({ id: z.string() }) })
      .parse(cli(userData, ['repo', 'add', '--path', clone]))
    const { mission } = MissionResponseSchema.parse(
      cli(userData, [
        'mission',
        'create',
        '--repo',
        `id:${repo.id}`,
        '--target-branch',
        'main',
        '--goal-file',
        path.join(clone, 'GOAL.md')
      ])
    )
    const shown = MissionResponseSchema.parse(
      cli(userData, ['mission', 'show', '--mission', mission.id])
    )
    const goalRevisionId = shown.mission.activeGoalRevisionId
    if (!goalRevisionId) {
      throw new Error('Missing active GoalRevision')
    }
    const proposal = fixturePlanProposal(
      JSON.parse(readFileSync(path.join(clone, 'scenarios', 'goal', 'decomposition.json'), 'utf8')),
      goalRevisionId
    )
    expect(proposal.tasks).toHaveLength(12)
    expect(proposal.edges).toHaveLength(20)
    const roots = proposal.tasks.filter(
      (task) => !proposal.edges.some((edge) => edge.toTaskId === task.id)
    )
    expect(roots.map((task) => task.id).sort()).toEqual(['T01', 'T02', 'T03'])
    expect(roots.map((task) => task.title).sort()).toEqual(READY_TITLES)
    const proposalPath = path.join(temp, 'proposal.json')
    writeFileSync(proposalPath, JSON.stringify(proposal, null, 2))
    const { planRevision } = PlanResponseSchema.parse(
      cli(userData, ['plan', 'propose', '--mission', mission.id, '--file', proposalPath])
    )
    cli(userData, ['plan', 'approve', '--plan', planRevision.id, '--resolver', 'e2e'])
    cli(userData, ['mission', 'start', '--mission', mission.id])
    const before = snapshot(userData, mission.id)
    const { tasks } = TaskListResponseSchema.parse(before.tasks)
    expect(tasks).toHaveLength(12)
    expect(tasks.map((task) => task.title).sort()).toEqual(
      proposal.tasks.map((task) => task.title).sort()
    )
    expect(
      tasks
        .filter((task) => task.stage === 'READY')
        .map((task) => task.title)
        .sort()
    ).toEqual(READY_TITLES)
    expect(tasks.filter((task) => task.stage === 'DEFINED')).toHaveLength(9)
    expect(tasks.every((task) => task.orcaStatus === 'ready')).toBe(true)
    expect(MissionResponseSchema.parse(before.mission).mission.status).toBe('EXECUTING')
    expect(PlanResponseSchema.parse(before.plan).planRevision.status).toBe('APPROVED')
    const goalText = readFileSync(path.join(clone, 'GOAL.md'), 'utf8')
    expect(GoalResponseSchema.parse(before.goal).goalRevision).toMatchObject({
      id: goalRevisionId,
      status: 'ACTIVE',
      objective: goalText,
      acceptanceCriteria: []
    })
    durationsMs.cliSetup = performance.now() - setupStarted
    const beforeUi = await missionUi(first.page, mission.id, goalText)
    const inspection = inspectMission(userData, mission.id)
    expect(inspection.binding.status).toBe('EXECUTING')
    const deniedStarted = performance.now()
    // task-update/worker-start can refuse at three layers: CLI terminal identity
    // (no_active_sender_terminal, before RPC), runtime Run binding (run_required /
    // consumer_fenced), then the Mission guard (mission_managed; M1-07 RPC tests).
    const commands = [
      { verb: 'reset', args: ['--tasks'], codes: ['mission_managed'] },
      {
        verb: 'task-update',
        args: ['--id', tasks[0].id, '--status', 'completed', '--run', inspection.binding.run_id],
        codes: ['mission_managed', 'run_required', 'consumer_fenced', 'no_active_sender_terminal']
      },
      {
        verb: 'worker-start',
        args: ['--task', tasks[0].id, '--agent', 'codex', '--run', inspection.binding.run_id],
        codes: ['mission_managed', 'run_required', 'consumer_fenced', 'no_active_sender_terminal']
      }
    ]
    for (const command of commands) {
      const result = invokeCompiledCli(userData, ['orchestration', command.verb, ...command.args])
      expect(result.status).not.toBe(0)
      const { error } = z
        .object({ ok: z.literal(false), error: z.object({ code: z.string() }) })
        .parse(result.json)
      expect(command.codes, command.verb).toContain(error.code)
      refusals[command.verb] = error.code
    }
    expect(JSON.stringify(snapshot(userData, mission.id))).toBe(JSON.stringify(before))
    expect(inspectMission(userData, mission.id).binding).toEqual(inspection.binding)
    durationsMs.refusedVerbs = performance.now() - deniedStarted
    const restartStarted = performance.now()
    await session.close(app)
    app = undefined
    const second = await session.launch()
    app = second.app
    await waitForSessionReady(second.page)
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData)
    expect(JSON.stringify(snapshot(userData, mission.id))).toBe(JSON.stringify(before))
    expect(inspectMission(userData, mission.id)).toEqual({
      binding: inspection.binding,
      lostBindings: []
    })
    expect(await missionUi(second.page, mission.id, goalText)).toEqual(beforeUi)
    durationsMs.restartAndAssertions = performance.now() - restartStarted
    const measurements = {
      fixtureCommit: head,
      missionId: mission.id,
      tasks: tasks.length,
      edges: proposal.edges.length,
      ready: tasks.filter((task) => task.stage === 'READY').length,
      defined: tasks.filter((task) => task.stage === 'DEFINED').length,
      orcaReady: tasks.filter((task) => task.orcaStatus === 'ready').length,
      refusals,
      recoveryRunBindingLost: 0,
      cliSnapshotIdentical: true,
      uiSnapshotIdentical: true,
      durationsMs: { ...durationsMs, total: performance.now() - started }
    }
    console.log(`[M1-exit] ${JSON.stringify(measurements)}`)
    await testInfo.attach('M1-exit-measurements', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json'
    })
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
})
