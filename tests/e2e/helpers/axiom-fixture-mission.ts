import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { z } from 'zod'
import { expect } from './orca-app'
import { createRestartSession } from './orca-restart'
import { waitForSessionReady } from './store'
import { fixturePlanProposal } from './fixture-plan-proposal'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'
import {
  buildFakeAgentCommandOverride,
  FAKE_AGENT_WINDOWS_SHELL
} from './fake-agent-command-override'
import {
  MissionResponseSchema,
  MissionPlanResponseSchema,
  type MissionSummary
} from '../../../src/shared/axiom-contract/mission-params'
import {
  PlanListResponseSchema,
  PlanResponseSchema
} from '../../../src/shared/axiom-contract/plan-params'

export const FIXTURE_COMMIT = 'a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642'
export function git(args: string[]) {
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
export function invoke(
  userData: string,
  args: string[],
  options: { timeoutMs?: number; paneKey?: string } = {}
) {
  return spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'out', 'cli', 'index.js'), ...args, '--json'],
    {
      env: {
        ...process.env,
        ORCA_USER_DATA_PATH: userData,
        ORCA_DEV_CLI_INVOCATION: '1',
        ORCA_BACKGROUND_LAUNCH: '1',
        ORCA_PANE_KEY: options.paneKey ?? 'e2e-forged-pane'
      },
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 30_000
    }
  )
}
export function cli(
  userData: string,
  args: string[],
  options: Parameters<typeof invoke>[2] = {}
): unknown {
  const result = invoke(userData, args, options)
  if (result.error) {
    throw result.error
  }
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return z.object({ ok: z.literal(true), result: z.unknown() }).parse(JSON.parse(result.stdout))
    .result
}

export async function withFixtureMission(
  testInfo: TestInfo,
  source: string,
  run: (fixture: {
    page: Page
    mission: MissionSummary
    clone: string
    userData: string
    ledgerPath: string
    temp: string
    releaseWorkers: () => void
    restart?: () => Promise<Page>
  }) => Promise<void>,
  options: { planner?: boolean; holdWorkers?: boolean; restart?: boolean } = {}
) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-fixture-mission-'))
  const executable = path.join(temp, process.platform === 'win32' ? 'codex.cmd' : 'codex')
  if (process.platform === 'win32') {
    writeFileSync(path.join(temp, 'fake-codex.js'), AXIOM_TEST_PROVIDER_SOURCE)
    writeFileSync(executable, '@echo off\r\nnode "%~dp0\\fake-codex.js" %*\r\n')
  } else {
    writeFileSync(executable, `#!/usr/bin/env node\n${AXIOM_TEST_PROVIDER_SOURCE}`)
    chmodSync(executable, 0o755)
  }
  const ledgerPath = path.join(temp, 'submissions.jsonl')
  const holdPath = `${ledgerPath}.hold`
  let cliEntry = path.join(process.cwd(), 'out', 'cli', 'index.js')
  if (options.holdWorkers) {
    // Gate the provider's existing binding poll, after preamble ACK but before any stub work.
    // This lets the exit spec observe all three live Workers without a timing-based delay.
    writeFileSync(holdPath, '')
    const proxy = path.join(temp, 'fixture-cli.cjs')
    writeFileSync(
      proxy,
      `const { existsSync } = require('node:fs')
if (process.argv[2] === 'attempt' && process.argv[3] === 'show' && existsSync(${JSON.stringify(holdPath)})) {
  process.stdout.write(JSON.stringify({ ok: false }))
  process.exit(1)
}
const result = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(cliEntry)}, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
`
    )
    cliEntry = proxy
  }
  const session = createRestartSession(testInfo, {
    ORCA_BACKGROUND_LAUNCH: '1',
    PATH: `${temp}${path.delimiter}${process.env.PATH ?? ''}`,
    AXIOM_E2E_LEDGER: ledgerPath,
    ORCA_E2E_CLI_ENTRY: cliEntry
  })
  let app: ElectronApplication | undefined
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
    let planRevision
    if (options.planner) {
      const { attempt } = MissionPlanResponseSchema.parse(
        cli(userData, ['mission', 'plan', '--mission', mission.id], { timeoutMs: 130_000 })
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
      planRevision = planRevisions[0]!
      expect(planRevision.status).toBe('PROPOSED')
      expect(planRevision.provenance).toMatchObject({ kind: 'planner', actor: 'codex' })
      expect(planRevision.tasks).toEqual(proposal.tasks)
      expect(planRevision.edges).toEqual(proposal.edges)
      expect(planRevision.tasks).toHaveLength(12)
      expect(planRevision.edges).toHaveLength(20)
      const incoming = new Set(planRevision.edges.map((edge) => edge.toTaskId))
      expect(
        planRevision.tasks
          .filter((task) => !incoming.has(task.id))
          .map((task) => task.id)
          .sort()
      ).toEqual(['T01', 'T02', 'T03'])
    } else {
      const planPath = path.join(temp, 'proposal.json')
      writeFileSync(planPath, JSON.stringify(proposal))
      planRevision = PlanResponseSchema.parse(
        cli(userData, ['plan', 'propose', '--mission', mission.id, '--file', planPath])
      ).planRevision
    }
    cli(userData, ['plan', 'approve', '--plan', planRevision.id, '--resolver', 'e2e'])
    cli(userData, ['mission', 'start', '--mission', mission.id])
    await run({
      page: first.page,
      mission,
      clone,
      userData,
      ledgerPath,
      temp,
      ...(options.restart
        ? {
            restart: async () => {
              if (!app) {
                throw new Error('Fixture app is not running')
              }
              await session.close(app)
              app = undefined
              const next = await session.launch()
              app = next.app
              await waitForSessionReady(next.page)
              await next.page.evaluate(
                async ({ command, shell }) => {
                  await window.__store?.getState().updateSettings({
                    agentCmdOverrides: { codex: command },
                    terminalWindowsShell: shell
                  })
                },
                {
                  command: buildFakeAgentCommandOverride(executable),
                  shell: FAKE_AGENT_WINDOWS_SHELL
                }
              )
              return next.page
            }
          }
        : {}),
      releaseWorkers: () => rmSync(holdPath, { force: true })
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
}
