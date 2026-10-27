import { seedCodexTestAccount } from './helpers/codex-test-account'
import { desktopCall } from './helpers/axiom-desktop-call'
import { readGoalFile } from '../../src/cli/handlers/axiom/input-files'
import { DEFAULT_MISSION_POLICY } from '../../src/shared/axiom-contract/mission-objects'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { AXIOM_TEST_PROVIDER_SOURCE } from './helpers/axiom-test-provider'
import {
  buildFakeAgentCommandOverride,
  FAKE_AGENT_WINDOWS_SHELL
} from './helpers/fake-agent-command-override'
import Database from '../../src/main/sqlite/sync-database'
import {
  MissionResponseSchema,
  MissionPlanResponseSchema
} from '../../src/shared/axiom-contract/mission-params'
import { PlanListResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { fixturePlanProposal } from './helpers/fixture-plan-proposal'

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
              "SELECT event, object_id, after FROM audit_events WHERE mission_id = ? AND event LIKE 'planner.%' ORDER BY sequence"
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
            .parse(JSON.parse(line))
        )
    : []
}

test('M2-09: a read-only Planner proposes the fixture DAG and releases after PLAN_REVIEW', async (// oxlint-disable-next-line no-empty-pattern -- Restart helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-m2-09-'))
  const executable = path.join(temp, process.platform === 'win32' ? 'codex.cmd' : 'codex')
  if (process.platform === 'win32') {
    writeFileSync(path.join(temp, 'fake-codex.js'), AXIOM_TEST_PROVIDER_SOURCE)
    writeFileSync(executable, '@echo off\r\nnode "%~dp0\\fake-codex.js" %*\r\n')
  } else {
    writeFileSync(executable, `#!/usr/bin/env node\n${AXIOM_TEST_PROVIDER_SOURCE}`)
    chmodSync(executable, 0o755)
  }
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
    seedCodexTestAccount(session.userDataDir)
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await first.page.evaluate(
      async ({ command, shell }) => {
        await window.__store?.getState().updateSettings({
          agentCmdOverrides: { codex: command },
          terminalWindowsShell: shell
        })
      },
      { command: buildFakeAgentCommandOverride(executable), shell: FAKE_AGENT_WINDOWS_SHELL }
    )
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
      patch: { routing: { preferredProviders: ['codex'] } }
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
    expect(attempt.provider).toBe('codex')
    expect(attempt.branch).toBe(`axiom/planner/${mission.id}/1`)
    await expect
      .poll(
        () =>
          MissionResponseSchema.parse(cli(userData, ['mission', 'show', '--mission', mission.id]))
            .mission.status,
        { timeout: 120_000 }
      )
      .toBe('PLAN_REVIEW')
    const { planRevisions } = PlanListResponseSchema.parse(
      cli(userData, ['plan', 'list', '--mission', mission.id])
    )
    expect(planRevisions).toHaveLength(1)
    const plan = planRevisions[0]!
    expect(plan.status).toBe('PROPOSED')
    expect(plan.provenance).toMatchObject({ kind: 'planner', actor: 'codex' })
    expect(plan.tasks).toHaveLength(12)
    expect(plan.edges).toHaveLength(20)
    const incoming = new Set(plan.edges.map((e) => e.toTaskId))
    expect(plan.tasks.filter((t) => !incoming.has(t.id))).toHaveLength(3)
    const expected = fixturePlanProposal(
      JSON.parse(readFileSync(path.join(clone, 'scenarios', 'goal', 'decomposition.json'), 'utf8')),
      mission.activeGoalRevisionId!
    )
    expect(plan.tasks).toEqual(expected.tasks)
    expect(plan.edges).toEqual(expected.edges)
    expect(
      TaskListResponseSchema.parse(cli(userData, ['task', 'list', '--mission', mission.id])).tasks
    ).toEqual([])
    await expect
      .poll(() => inspect(userData, mission.id).audits.some((a) => a.event === 'planner.stopped'), {
        timeout: 120_000
      })
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
        .poll(() => inspect(userData, mission.id).planners[0]?.release_state, { timeout: 120_000 })
        .toBe('released')
    }
    await expect
      .poll(() => ledger(ledgerPath).find((e) => e.kind === 'proposal')?.response?.ok)
      .toBe(true)
    expect(ledger(ledgerPath).filter((e) => e.kind === 'error')).toEqual([])
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
})
