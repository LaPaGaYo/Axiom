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
  type MissionSummary
} from '../../../src/shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../../src/shared/axiom-contract/plan-params'

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
export function invoke(userData: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'out', 'cli', 'index.js'), ...args, '--json'],
    {
      env: {
        ...process.env,
        ORCA_USER_DATA_PATH: userData,
        ORCA_DEV_CLI_INVOCATION: '1',
        ORCA_BACKGROUND_LAUNCH: '1',
        ORCA_PANE_KEY: 'e2e-forged-pane'
      },
      encoding: 'utf8',
      timeout: 30_000
    }
  )
}
export function cli(userData: string, args: string[]): unknown {
  const result = invoke(userData, args)
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
  }) => Promise<void>
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
    await run({ page: first.page, mission, clone, userData, ledgerPath, temp })
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
