import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { ArtifactStore } from '../../../src/main/axiom/artifacts/artifact-store'
import { channelFixture } from '../../../src/main/axiom/execution/attempt-channel-fixture.test-support'
import { RecoveryService } from '../../../src/main/axiom/recovery/recovery-service'

it('records the exit audit when the kernel fails the dispatch before Recovery runs', async () => {
  const f = channelFixture()
  const root = mkdtempSync(path.join(os.tmpdir(), 'axiom-exit-audit-'))
  try {
    vi.spyOn(f.runtime, 'showTerminal').mockRejectedValue(new Error('Exited terminal'))
    const recovery = new RecoveryService(f.db, f.store, f.missions, {
      runtime: f.runtime,
      artifacts: new ArtifactStore(f.store, root)
    })
    // The same kernel operation used by failActiveDispatchOnExit before escalation.
    f.db.failDispatch(f.t01.attemptId, 'Worker exited 137', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    const before = f.store.listAuditEvents({ missionId: f.mission.id }).length
    await recovery.reconcileAttempts()
    expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('failed')
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('READY')
    expect(
      f.store
        .listAuditEvents({ missionId: f.mission.id })
        .slice(before)
        .map((event) => event.event)
    ).toEqual(['attempt.failed', 'task.stage', 'task.stage'])
  } finally {
    f.db.close()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  }
})
