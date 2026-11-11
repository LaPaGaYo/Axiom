import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, vi } from 'vitest'
import { interruptionFixture } from '../execution/interruption-fixture.test-support'
import { preservedRepository } from '../execution/preserved-snapshot.test-support'
import * as files from '../execution/headless-attempt-files'
import * as observation from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { stopHeadlessAttemptWatchers } from '../execution/headless-attempt-watcher'
import { AttemptPreservedAuditSchema } from '../execution/preserved-snapshot-contract'
import { RecoveryService } from './recovery-service'

export async function recoveryPreservationFixture() {
  const f = interruptionFixture()
  const repo = await preservedRepository()
  const binding = f.store.getAttemptBindingByDispatch(f.t01.attemptId)
  const task = f.store.getTaskStage(f.t01.taskId)
  if (!binding || !task) {
    throw new Error('Missing fixture binding')
  }
  await repo.git(['checkout', '-b', binding.branch])
  await repo.git(['branch', `axiom/integration/${f.mission.id}`])
  await writeFile(path.join(repo.root, 'partial.ts'), 'export const partial = true\n')
  f.db.db.prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?').run(
    JSON.stringify({
      ...task.spec,
      scope: { ...task.spec.scope, allowedPaths: ['**'] },
      budget: { maxRuntimeMinutes: 1 }
    }),
    task.taskId
  )
  f.db.db
    .prepare(
      'UPDATE worker_dispatches SET runtime_epoch = ?, worktree_id = ? WHERE dispatch_id = ?'
    )
    .run(f.runtime.getRuntimeId(), `repo::${repo.root}`, f.t01.attemptId)
  let now =
    Date.parse(binding.createdAt.replace(' ', 'T') + (binding.createdAt.endsWith('Z') ? '' : 'Z')) +
    120_000
  const launch = {
    baselineSha: repo.baselineSha,
    worktreeId: `repo::${repo.root}`,
    branch: binding.branch
  }
  const eventsText = JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'Partial work left for review' }
  })
  vi.mocked(files.readHeadlessFile).mockImplementation(async (_directory, name) => {
    if (name === 'launch.json') {
      return JSON.stringify(launch)
    }
    if (name === 'events.jsonl') {
      return eventsText
    }
    return undefined
  })
  vi.spyOn(observation, 'inspectWorkerTerminal').mockResolvedValue({
    terminal: null,
    terminalHandle: f.t01.from,
    exact: true,
    status: 'live'
  })
  vi.spyOn(f.runtime, 'closeTerminal').mockResolvedValue({
    handle: f.t01.from,
    tabId: 'tab',
    ptyKilled: true
  })
  const put = f.put.getMockImplementation()
  f.put.mockImplementation(async (input) => {
    expect(f.db.db.isTransaction).toBe(false)
    if (!put) {
      throw new Error('Missing Artifact writer')
    }
    return put(input)
  })
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: f.plane.artifacts,
    now: () => now
  })
  const audits = () => f.store.listAuditEvents({ missionId: f.mission.id })
  const recorded = () =>
    AttemptPreservedAuditSchema.parse(
      audits().find((row) => row.event === 'attempt.preserved')?.after
    )
  const ref = `refs/axiom/preserved/${task.taskId}/1`
  return {
    ...f,
    repo,
    binding,
    launch,
    recovery,
    audits,
    recorded,
    ref,
    advance: (ms: number) => {
      now += ms
    },
    observe: (status: 'live' | 'exited' | 'unverifiable') =>
      vi
        .mocked(observation.inspectWorkerTerminal)
        .mockResolvedValue({ terminal: null, terminalHandle: f.t01.from, exact: true, status }),
    cleanup: async () => {
      stopHeadlessAttemptWatchers(f.runtime)
      await f.plane.effects.stop()
      vi.clearAllTimers()
      f.db.close()
      vi.restoreAllMocks()
      vi.useRealTimers()
      await rm(repo.root, { recursive: true, force: true })
    }
  }
}
