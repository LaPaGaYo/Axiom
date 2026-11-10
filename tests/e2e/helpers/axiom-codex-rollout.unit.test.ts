import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'
import { readCodexRolloutLimit } from '../../../src/main/axiom/execution/codex-rollout-limit'
import {
  interruptionFixture,
  interruptionNow
} from '../../../src/main/axiom/execution/interruption-fixture.test-support'
import { submitExitedAttempt } from '../../../src/main/axiom/execution/attempt-exit-submission'
import { stopHeadlessAttemptWatchers } from '../../../src/main/axiom/execution/headless-attempt-watcher'
import * as e2e from '../../../src/main/e2e-config'

let root: string
let f: ReturnType<typeof interruptionFixture>
beforeEach(() => {
  f = interruptionFixture()
  root = mkdtempSync(path.join(os.tmpdir(), 'axiom-codex-rollout-stub-'))
})
afterEach(async () => {
  stopHeadlessAttemptWatchers(f.runtime)
  await f.plane.effects.stop()
  vi.clearAllTimers()
  f.db.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

it.each([false, true])(
  'records the Codex rollout stub audit and continuation (e2e=%s)',
  async (enabled) => {
    vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled })
    vi.stubEnv('AXIOM_E2E_INTERRUPTION_BACKOFF_MS', '100,200,300')
    const home = path.join(root, 'account')
    const worktree = path.join(root, 'worktree')
    mkdirSync(worktree)
    const git = spawnSync('git', ['init', '--quiet'], { cwd: worktree, encoding: 'utf8' })
    expect(git.status, git.stderr).toBe(0)
    const ledger = path.join(root, 'ledger')
    const provider = path.join(root, 'provider.cjs')
    // Freeze the child process clock without adding a production or stub timing setting.
    writeFileSync(
      provider,
      `globalThis.Date = class extends Date {
    constructor(value = ${interruptionNow}) { super(value) }
    static now() { return ${interruptionNow} }
  };\n${AXIOM_TEST_PROVIDER_SOURCE}`
    )
    writeFileSync(`${ledger}.interrupt-${f.t01.taskId}`, '1')
    writeFileSync(`${ledger}.rollout-${f.t01.taskId}`, '1')
    const result = spawnSync(
      process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
      [
        provider,
        'exec',
        '--json',
        '-s',
        'workspace-write',
        '-C',
        worktree,
        '-o',
        path.join(root, 'report.md'),
        '-'
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        input: `Mission: ${f.mission.id}\nTask: ${f.t01.taskId}\nAttempt: ${f.t01.attemptId}\n`,
        env: {
          ...process.env,
          CODEX_HOME: home,
          AXIOM_E2E_LEDGER: ledger,
          ORCA_E2E_CLI_ENTRY: 'unused'
        }
      }
    )
    expect(result.status, result.stderr).toBe(75)
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const threadId = `fixture-${f.t01.attemptId}`
    expect(events[0]).toEqual({ type: 'thread.started', thread_id: threadId })
    expect(events.at(-1)).toEqual({
      type: 'turn.failed',
      error: { message: 'Fixture usage limit reached' }
    })
    const date = new Date(interruptionNow)
    const pad = (value: number) => String(value).padStart(2, '0')
    const day = [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())]
    const directory = path.join(home, 'sessions', ...day)
    const filename = `rollout-${day.join('-')}T${[pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('-')}-${threadId}.jsonl`
    expect(readdirSync(directory)).toEqual([filename])
    const rows = readFileSync(path.join(directory, filename), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(rows).toMatchObject([
      { type: 'session_meta', payload: { creator_account_id: 'ROLLOUT_DECOY_ACCOUNT' } },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: null,
          rate_limits: {
            limit_id: 'codex',
            primary: { used_percent: 100, window_minutes: 300 },
            secondary: { used_percent: 4 },
            plan_type: 'ROLLOUT_DECOY_PLAN',
            credits: { balance: 'ROLLOUT_DECOY_BALANCE' }
          }
        }
      }
    ])
    const reset = interruptionNow + 10_000
    expect(
      await readCodexRolloutLimit({
        accountHome: home,
        threadId,
        startedAt: interruptionNow,
        now: () => interruptionNow
      })
    ).toEqual({ window: 'session', resetsAt: reset })
    f.store.appendAuditEvent({
      missionId: f.mission.id,
      actor: 'AttemptLauncher',
      event: 'attempt.headless_prepared',
      objectKind: 'attempt',
      objectId: f.t01.attemptId,
      before: null,
      after: { combination: { effective: { codexHome: { kind: 'account', path: home } } } }
    })
    f.db.db
      .prepare('UPDATE worker_dispatches SET created_at = ? WHERE dispatch_id = ?')
      .run('2026-11-09 11:59:00', f.t01.attemptId)
    f.setEvents(events)
    f.setExit(String(result.status))
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
    const audit = f.store
      .listAuditEvents({ missionId: f.mission.id })
      .find((event) => event.event === 'attempt.failed')
    expect(audit?.after).toEqual({
      taskId: f.t01.taskId,
      reason: 'process_exited',
      evidence: 'exit_code',
      exitCode: 75,
      settlement: { kind: 'interrupted' },
      failure: {
        class: 'usage_limit',
        retryable: true,
        source: 'text',
        window: 'session',
        resetsAt: new Date(reset).toISOString()
      },
      lastError: 'Fixture usage limit reached',
      lastErrorEvent: { type: 'turn.failed', message: 'Fixture usage limit reached' },
      lastMessageExcerpt: '',
      providerSessionId: threadId
    })
    const continuation = f.effect(1)
    expect(continuation).toMatchObject({
      kind: 'attempt.continue',
      key: `${f.t01.taskId}/1`,
      status: 'pending',
      attempts: 0,
      dueAt: new Date(reset + (enabled ? 0 : 60000)).toISOString(),
      payload: {
        taskId: f.t01.taskId,
        seq: 1,
        chain: 1,
        failureClass: 'usage_limit',
        resetsAt: new Date(reset).toISOString(),
        account: { provider: 'codex', key: expect.stringMatching(/^[a-f0-9]{64}$/) }
      }
    })
    expect(JSON.stringify([audit, continuation])).not.toMatch(/ROLLOUT_DECOY/)
    expect(JSON.stringify([audit, continuation])).not.toContain(home)
    expect(z.object({ actor: z.string() }).parse(audit).actor).toBe('AttemptSettlement')
    console.info('M3-06-2a-3 Codex audit:', JSON.stringify(audit))
    console.info('M3-06-2a-3 Codex effect:', JSON.stringify(continuation))
  }
)
