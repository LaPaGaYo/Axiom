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
import {
  CandidateRowCodec,
  SubmissionRowCodec,
  VerificationRunRowCodec
} from '../../src/main/axiom/db/submission-rows'
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
function invoke(userData: string, args: string[]) {
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
function cli(userData: string, args: string[]): unknown {
  const result = invoke(userData, args)
  if (result.error) {
    throw result.error
  }
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return z.object({ ok: z.literal(true), result: z.unknown() }).parse(JSON.parse(result.stdout))
    .result
}
const Binding = z.object({
  task_id: z.string(),
  dispatch_id: z.string(),
  seq: z.number(),
  branch: z.string()
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
              'SELECT task_id, dispatch_id, seq, branch FROM attempt_bindings WHERE mission_id = ? AND dispatch_id IS NOT NULL ORDER BY task_id, seq'
            )
            .all(missionId)
        ),
      tasks: z
        .array(z.object({ task_id: z.string(), stage: z.string() }))
        .parse(
          db
            .prepare('SELECT task_id, stage FROM task_stages WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      candidates: z
        .array(CandidateRowCodec)
        .parse(
          db
            .prepare('SELECT * FROM candidates WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      submissions: z
        .array(SubmissionRowCodec)
        .parse(
          db
            .prepare('SELECT * FROM submissions WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      verification: z
        .array(VerificationRunRowCodec)
        .parse(
          db
            .prepare('SELECT * FROM verification_runs WHERE mission_id = ? ORDER BY task_id')
            .all(missionId)
        ),
      dispatches: z
        .array(z.object({ id: z.string(), status: z.string() }))
        .parse(
          db
            .prepare(
              'SELECT d.id, d.status FROM dispatch_contexts d JOIN attempt_bindings b ON b.dispatch_id = d.id WHERE b.mission_id = ? ORDER BY d.id'
            )
            .all(missionId)
        )
    }
  } finally {
    db.close()
  }
}
const LedgerLine = z.object({ kind: z.string().optional(), attemptId: z.string() }).passthrough()
function readLedger(file: string) {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => LedgerLine.parse(JSON.parse(line)))
    : []
}

test('M2-07: three fixture Workers submit immutable Candidates and reject a forged duplicate', async (// oxlint-disable-next-line no-empty-pattern -- Restart helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-m2-07-'))
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
    const baseRef = `refs/heads/axiom/integration/${mission.id}`
    const base = git(['-C', clone, 'rev-parse', baseRef])
    const baseTree = git(['-C', clone, 'rev-parse', `${baseRef}^{tree}`])
    expect(base).toBe(FIXTURE_COMMIT)
    await expect
      .poll(
        () => inspect(userData, mission.id).tasks.filter((t) => t.stage === 'SUBMITTED').length,
        { timeout: 120_000 }
      )
      .toBe(3)
    const settled = inspect(userData, mission.id)
    expect(settled.bindings).toHaveLength(3)
    expect(settled.candidates).toHaveLength(3)
    expect(settled.submissions).toHaveLength(3)
    expect(settled.verification).toHaveLength(3)
    expect(settled.dispatches.every((d) => d.status === 'completed')).toBe(true)
    for (const binding of settled.bindings) {
      const candidate = settled.candidates.find((c) => c.attemptId === binding.dispatch_id)!
      const submission = settled.submissions.find((s) => s.attemptId === binding.dispatch_id)!
      expect(candidate.status).toBe('ACTIVE')
      expect(candidate.commitSha).toBe(
        git(['-C', clone, 'rev-parse', `refs/heads/${binding.branch}`])
      )
      expect(candidate.commitSha).not.toBe(base)
      expect(candidate.treeSha).toBe(
        git(['-C', clone, 'rev-parse', `${candidate.commitSha}^{tree}`])
      )
      expect(candidate.treeSha).not.toBe(baseTree)
      expect(submission.candidateId).toBe(candidate.id)
      expect(submission.report.summary).not.toBe('')
      expect(submission.report.artifacts).toHaveLength(1)
      expect(settled.verification.find((v) => v.candidateId === candidate.id)).toMatchObject({
        taskId: binding.task_id,
        status: 'QUEUED',
        verifier: 'VerificationService'
      })
    }
    const attempts = AttemptListResponseSchema.parse(
      cli(userData, ['attempt', 'list', '--mission', mission.id])
    ).attempts
    expect(attempts).toHaveLength(3)
    expect(attempts.every((a) => a.state === 'SUBMITTED')).toBe(true)
    await expect
      .poll(() => readLedger(ledgerPath).filter((e) => e.kind === 'submission').length)
      .toBe(3)
    const ledger = readLedger(ledgerPath)
    expect(ledger.filter((e) => e.kind === undefined)).toHaveLength(3)
    expect(ledger.filter((e) => e.kind === 'artifact')).toHaveLength(3)
    expect(ledger.filter((e) => e.kind === 'error')).toEqual([])
    const forgedReport = path.join(temp, 'forged.json')
    writeFileSync(forgedReport, JSON.stringify(settled.submissions[0]!.report))
    const forged = invoke(userData, [
      'attempt',
      'submit',
      '--attempt',
      settled.bindings[0]!.dispatch_id,
      '--from',
      'term_forged',
      '--dispatch-capability',
      'dcap_wrong',
      '--report',
      forgedReport
    ])
    expect(forged.status).not.toBe(0)
    expect(JSON.parse(forged.stdout)).toMatchObject({
      ok: false,
      error: { code: 'dispatch_capability_invalid' }
    })
    expect(inspect(userData, mission.id)).toEqual(settled)
    expect(git(['-C', clone, 'rev-parse', baseRef])).toBe(base)
    expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(base)
    console.log(
      `[M2-07] ${JSON.stringify({ missionId: mission.id, submitted: 3, activeCandidates: 3, submissions: 3, queuedVerificationRuns: 3, completedDispatches: 3, candidateCommits: settled.candidates.map((c) => c.commitSha), integrationBaseUnchanged: base, forgedSubmit: 'dispatch_capability_invalid', totalMs: performance.now() - started })}`
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
