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
import { performance } from 'node:perf_hooks'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { fixturePlanProposal } from './helpers/fixture-plan-proposal'
import { AXIOM_TEST_PROVIDER_SOURCE } from './helpers/axiom-test-provider'
import {
  buildFakeAgentCommandOverride,
  FAKE_AGENT_WINDOWS_SHELL
} from './helpers/fake-agent-command-override'
import Database from '../../src/main/sqlite/sync-database'
import { MissionResponseSchema } from '../../src/shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import { AttemptListResponseSchema } from '../../src/shared/axiom-contract/attempt-params'

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
function cli(userData: string, args: string[]): unknown {
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
  expect(result.status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`).toBe(0)
  return z.object({ ok: z.literal(true), result: z.unknown() }).parse(JSON.parse(result.stdout))
    .result
}
const Binding = z.object({
  task_id: z.string(),
  dispatch_id: z.string().nullable(),
  seq: z.number(),
  branch: z.string()
})
const Task = z.object({
  task_id: z.string(),
  stage: z.string(),
  attempt_count: z.number(),
  spec: z.string()
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
              'SELECT task_id, dispatch_id, seq, branch FROM attempt_bindings WHERE mission_id = ? ORDER BY task_id, seq'
            )
            .all(missionId)
        ),
      tasks: z
        .array(Task)
        .parse(
          db
            .prepare(
              'SELECT task_id, stage, attempt_count, spec FROM task_stages WHERE mission_id = ? ORDER BY task_id'
            )
            .all(missionId)
        ),
      lost: db
        .prepare(
          "SELECT event FROM audit_events WHERE mission_id = ? AND event = 'recovery.run_binding_lost'"
        )
        .all(missionId).length
    }
  } finally {
    db.close()
  }
}
const Ledger = z.object({
  cwd: z.string(),
  attemptId: z.string(),
  terminalHandle: z.string().min(1),
  paneKey: z.string().min(1),
  preambleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  preambleBytes: z.number().positive()
})
function readLedger(file: string) {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => Ledger.parse(JSON.parse(line)))
    : []
}

test('M2-05: launches three fixture Attempts and preserves identity without relaunch on restart', async (// oxlint-disable-next-line no-empty-pattern -- Restart helper owns both app launches.
{}, testInfo) => {
  test.setTimeout(300_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-m2-05-'))
  const executable = path.join(temp, process.platform === 'win32' ? 'codex.cmd' : 'codex')
  if (process.platform === 'win32') {
    writeFileSync(path.join(temp, 'fake-codex.js'), AXIOM_TEST_PROVIDER_SOURCE)
    writeFileSync(executable, '@echo off\r\nnode "%~dp0\\fake-codex.js" %*\r\n')
  } else {
    writeFileSync(executable, `#!/usr/bin/env node\n${AXIOM_TEST_PROVIDER_SOURCE}`)
    chmodSync(executable, 0o755)
  }
  const ledgerPath = path.join(temp, 'launches.jsonl')
  const session = createRestartSession(testInfo, {
    ORCA_BACKGROUND_LAUNCH: '1',
    PATH: `${temp}${path.delimiter}${process.env.PATH ?? ''}`,
    AXIOM_E2E_LEDGER: ledgerPath
  })
  let app: ElectronApplication | undefined
  const started = performance.now()
  try {
    const clone = path.join(temp, 'fixture')
    git(['clone', '--no-hardlinks', '--branch', 'main', realpathSync(source), clone])
    expect(git(['-C', clone, 'rev-parse', 'HEAD'])).toBe(FIXTURE_COMMIT)
    expect(git(['-C', clone, 'rev-parse', 'fixture-v1^{commit}'])).toBe(FIXTURE_COMMIT)
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await first.page.evaluate(
      async ({ command, shell }) => {
        await window.__store
          ?.getState()
          .updateSettings({ agentCmdOverrides: { codex: command }, terminalWindowsShell: shell })
      },
      { command: buildFakeAgentCommandOverride(executable), shell: FAKE_AGENT_WINDOWS_SHELL }
    )
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
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
    const routing = path.join(temp, 'routing.json')
    writeFileSync(routing, JSON.stringify({ preferredProviders: ['codex'] }))
    cli(userData, [
      'mission',
      'policy',
      'update',
      '--mission',
      mission.id,
      '--routing-file',
      routing
    ])
    if (!mission.activeGoalRevisionId) {
      throw new Error('Missing GoalRevision')
    }
    const proposal = fixturePlanProposal(
      JSON.parse(readFileSync(path.join(clone, 'scenarios', 'goal', 'decomposition.json'), 'utf8')),
      mission.activeGoalRevisionId
    )
    const planPath = path.join(temp, 'proposal.json')
    writeFileSync(planPath, JSON.stringify(proposal))
    const { planRevision } = PlanResponseSchema.parse(
      cli(userData, ['plan', 'propose', '--mission', mission.id, '--file', planPath])
    )
    cli(userData, ['plan', 'approve', '--plan', planRevision.id, '--resolver', 'e2e'])
    cli(userData, ['mission', 'start', '--mission', mission.id])
    const list = () =>
      AttemptListResponseSchema.parse(cli(userData, ['attempt', 'list', '--mission', mission.id]))
        .attempts
    await expect
      .poll(() => list().filter((a) => a.state === 'RUNNING' && a.liveness === 'live').length, {
        timeout: 60_000
      })
      .toBe(3)
    const before = inspect(userData, mission.id)
    expect(before.bindings).toHaveLength(3)
    expect(before.bindings.every((b) => b.seq === 1 && b.dispatch_id !== null)).toBe(true)
    expect(before.tasks.filter((t) => t.stage === 'RUNNING')).toHaveLength(3)
    expect(before.tasks.filter((t) => t.stage === 'DEFINED')).toHaveLength(9)
    expect(
      before.tasks
        .filter((t) => t.stage === 'RUNNING')
        .map((t) => z.object({ id: z.string() }).parse(JSON.parse(t.spec)).id)
        .sort()
    ).toEqual(['T01', 'T02', 'T03'])
    expect(before.lost).toBe(0)
    const attempts = list()
    expect(attempts).toHaveLength(3)
    const ids = attempts.map((a) => a.attemptId).sort()
    expect(new Set(ids).size).toBe(3)
    await expect.poll(() => readLedger(ledgerPath).length).toBe(3)
    const ledger = readLedger(ledgerPath)
    expect(ledger.map((e) => e.attemptId).sort()).toEqual(ids)
    const base = git([
      '-C',
      clone,
      'rev-parse',
      '--verify',
      `refs/heads/axiom/integration/${mission.id}`
    ])
    expect(base).toBe(git(['-C', clone, 'rev-parse', 'refs/heads/main']))
    expect(base).toBe(FIXTURE_COMMIT)
    for (const attempt of attempts) {
      expect(['retained', 'released', 'pending']).toContain(attempt.workspace)
      const bound = before.bindings.find((b) => b.dispatch_id === attempt.attemptId)!
      expect(bound.branch).toBe(`axiom/attempt/${bound.task_id}/1`)
      expect(git(['-C', clone, 'rev-parse', '--verify', `refs/heads/${bound.branch}`])).toBe(base)
      const entry = ledger.find((e) => e.attemptId === attempt.attemptId)!
      expect(entry.terminalHandle).toMatch(/^term_/)
      expect(git(['-C', entry.cwd, 'rev-parse', 'HEAD'])).toBe(base)
      expect(git(['-C', entry.cwd, 'symbolic-ref', '--short', 'HEAD'])).toBe(bound.branch)
    }
    const launchedMs = performance.now() - started
    await session.close(app)
    app = undefined
    const second = await session.launch()
    app = second.app
    await waitForSessionReady(second.page)
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData)
    expect(inspect(userData, mission.id)).toEqual(before)
    expect(readLedger(ledgerPath)).toEqual(ledger)
    const restarted = list()
    expect(restarted.map((a) => a.attemptId).sort()).toEqual(ids)
    for (const a of restarted) {
      expect(['live', 'exited', 'unverifiable']).toContain(a.liveness)
    }
    console.log(
      `[M2-05] ${JSON.stringify({
        missionId: mission.id,
        fixtureCommit: base,
        bindings: before.bindings.length,
        workspace: attempts.map((a) => a.workspace),
        restartLiveness: restarted.map((a) => a.liveness),
        preambleBytes: ledger.map((e) => e.preambleBytes),
        recoveryRunBindingLost: 0,
        ledgerLines: ledger.length,
        launchedMs,
        totalMs: performance.now() - started
      })}`
    )
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
