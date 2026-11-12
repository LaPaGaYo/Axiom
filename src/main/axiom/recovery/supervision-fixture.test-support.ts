import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import { recoveryPreservationFixture } from './preservation-fixture.test-support'
import * as files from '../execution/headless-attempt-files'
import * as stops from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import * as e2e from '../../e2e-config'

export async function supervisionFixture() {
  const f = await recoveryPreservationFixture()
  const directory = mkdtempSync(path.join(tmpdir(), 'axiom-supervision-'))
  const eventsFile = path.join(directory, 'events.jsonl')
  vi.mocked(files.headlessAttemptDirectory).mockReturnValue(directory)
  const startedAt = Date.parse(
    f.binding.createdAt.replace(' ', 'T') + (f.binding.createdAt.endsWith('Z') ? '' : 'Z')
  )
  let now = startedAt + 120_000
  let receipt: 'stopped' | 'stop_unknown' = 'stopped'
  const stop = vi.spyOn(stops, 'stopLocalWorker').mockImplementation(async (runtime, id) => {
    f.db.beginWorkerStop(id, runtime.getRuntimeId())
    if (receipt === 'stopped') {
      f.db.settleWorkerStop(id)
    } else {
      f.db.markWorkerStopUnknown(id, 'Fixture stop unconfirmed')
    }
    return { dispatchId: id, state: receipt }
  })
  const config = e2e.getMainE2EConfig()
  const e2eConfig = vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...config, enabled: false })
  function budget(minutes?: number) {
    const task = f.store.getTaskStage(f.t01.taskId)
    if (!task) {
      throw new Error('Missing supervision Task')
    }
    f.db.db.prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?').run(
      JSON.stringify({
        ...task.spec,
        budget: minutes === undefined ? {} : { maxRuntimeMinutes: minutes }
      }),
      task.taskId
    )
  }
  function setNow(value: number) {
    f.advance(value - now)
    now = value
  }
  return {
    ...f,
    directory,
    eventsFile,
    startedAt,
    stop,
    budget,
    now: () => now,
    setNow,
    tick: () => f.recovery.reconcileAttempts(),
    events: (lastEventAt = now) => {
      writeFileSync(eventsFile, '{"type":"item.completed"}\n')
      utimesSync(eventsFile, lastEventAt / 1000, lastEventAt / 1000)
    },
    receipt: (state: typeof receipt) => {
      receipt = state
    },
    e2e: (enabled: boolean) => e2eConfig.mockReturnValue({ ...config, enabled }),
    rule: (rule: string) =>
      f
        .audits()
        .filter(
          (audit) =>
            audit.event === 'attempt.supervised' &&
            audit.after !== null &&
            typeof audit.after === 'object' &&
            !Array.isArray(audit.after) &&
            audit.after.rule === rule
        ),
    cadence: () => f.audits().filter((audit) => audit.event === 'attempt.cadence'),
    cleanup: async () => {
      rmSync(directory, { recursive: true, force: true })
      vi.unstubAllEnvs()
      await f.cleanup()
    }
  }
}
