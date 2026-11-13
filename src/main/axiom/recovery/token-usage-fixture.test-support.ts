import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { vi } from 'vitest'
import { submissionFixture } from '../execution/submission-fixture.test-support'
import * as files from '../execution/headless-attempt-files'
import * as observation from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { stopHeadlessAttemptWatchers } from '../execution/headless-attempt-watcher'
import { getAxiomControlPlane } from '../control-plane'
import { RecoveryService } from './recovery-service'

export const usageStart = Date.parse('2026-11-12T12:00:00Z')
export const usageThread = 'fixture-usage-thread'
export const usageDecoy = 'fixture-private-account-decoy'
export const iso = (ms: number) => new Date(ms).toISOString()
export function recordUsageEvidence(name: string, value: unknown) {
  const directory = process.env.AXIOM_TOKEN_USAGE_EVIDENCE_DIRECTORY
  if (directory) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2))
  }
}

export function tokenUsageFixture() {
  const f = submissionFixture()
  const plane = getAxiomControlPlane(f.runtime)
  const root = mkdtempSync(path.join(tmpdir(), 'axiom-token-usage-'))
  const home = path.join(root, 'account')
  let now = usageStart + 2000
  vi.spyOn(files, 'headlessAttemptDirectory').mockImplementation((id) => path.join(root, id))
  vi.spyOn(files, 'readHeadlessFile').mockResolvedValue(undefined)
  vi.spyOn(observation, 'inspectWorkerTerminal').mockResolvedValue({
    terminal: null,
    terminalHandle: f.t01.from,
    exact: true,
    status: 'live'
  })
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: plane.artifacts,
    now: () => now
  })
  function prepare(worker = f.t01, provider: 'codex' | 'claude' = 'codex', at = usageStart) {
    const task = f.store.getTaskStage(worker.taskId)
    if (!task) {
      throw new Error('Missing fixture Task')
    }
    const spec = f.store.insertAgentSpec({
      version: 1,
      role: 'worker',
      missionId: f.mission.id,
      taskId: task.taskId,
      contextPackageId: 'test-context',
      provider,
      model: 'fixture',
      endpointProfile: 'subscription',
      reasoning: { effort: 'medium' },
      capabilities: [],
      acceptanceCriteria: task.spec.acceptanceCriteria,
      permissions: { write: ['**'], network: 'restricted', tools: ['shell', 'git-readonly'] },
      budget: { maxRuntimeMinutes: 120 },
      workspace: { strategy: 'attempt-worktree' },
      submissionContract: 'axiom-submission-v1',
      selection: {
        installed: [provider],
        filtered: [],
        ranked: [provider],
        chosen: provider,
        rationale: 'Usage fixture'
      }
    })
    f.db.db
      .prepare(
        'UPDATE attempt_bindings SET agent_spec_id = ?, created_at = ? WHERE dispatch_id = ?'
      )
      .run(spec.id, iso(at), worker.attemptId)
    f.db.db
      .prepare(
        'UPDATE worker_dispatches SET start_options = ?, runtime_epoch = ?, created_at = ?, updated_at = ? WHERE dispatch_id = ?'
      )
      .run(
        JSON.stringify({ channel: 'headless', agent: provider }),
        f.runtime.getRuntimeId(),
        iso(at),
        iso(now),
        worker.attemptId
      )
    mkdirSync(path.join(root, worker.attemptId), { recursive: true })
    prepared(worker.attemptId)
    return worker
  }
  function prepared(id: string, session?: { originSeq: number; fromSeq: number }) {
    f.store.appendAuditEvent({
      missionId: f.mission.id,
      actor: 'fixture',
      objectKind: 'attempt',
      objectId: id,
      event: 'attempt.headless_prepared',
      before: null,
      after: {
        combination: { effective: { codexHome: { kind: 'account', path: home } } },
        ...(session
          ? { session: { strategy: 'resumed_in_place', id: usageThread, ...session } }
          : {})
      }
    })
  }
  function events(rows: unknown[], worker = f.t01) {
    writeFileSync(
      path.join(root, worker.attemptId, 'events.jsonl'),
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
    )
  }
  function rollout(rows: unknown[], padding = '') {
    const day = new Date(usageStart)
    const directory = path.join(
      home,
      'sessions',
      String(day.getFullYear()),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0')
    )
    mkdirSync(directory, { recursive: true })
    const file = path.join(directory, `rollout-fixture-${usageThread}.jsonl`)
    writeFileSync(file, `${padding + rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    return file
  }
  const row = z.object({
    dispatch_id: z.string(),
    mission_id: z.string(),
    task_id: z.string(),
    seq: z.number(),
    provider: z.string(),
    new_tokens: z.number(),
    input_tokens: z.number(),
    cached_input_tokens: z.number(),
    cache_write_tokens: z.number(),
    output_tokens: z.number(),
    reasoning_tokens: z.number(),
    status: z.string(),
    final: z.number(),
    measured_at: z.string()
  })
  function ledger() {
    if (
      !f.db.db.prepare("SELECT name FROM sqlite_master WHERE name = 'attempt_token_usage'").get()
    ) {
      return []
    }
    return z
      .array(row)
      .parse(
        f.db.db
          .prepare(
            `SELECT ${Object.keys(row.shape).join(', ')} FROM attempt_token_usage ORDER BY seq`
          )
          .all()
      )
  }
  prepare()
  events([{ type: 'thread.started', thread_id: usageThread }])
  return {
    ...f,
    root,
    home,
    plane,
    recovery,
    prepare,
    prepared,
    events,
    rollout,
    ledger,
    now: () => now,
    setNow: (value: number) => {
      now = value
    },
    tick: () => recovery.reconcileAttempts(),
    cleanup: async () => {
      stopHeadlessAttemptWatchers(f.runtime)
      await plane.effects.stop()
      f.db.close()
      vi.clearAllTimers()
      vi.restoreAllMocks()
      vi.useRealTimers()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
