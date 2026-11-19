import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { missionFinalization } from '../read-models/finalization-reads'
import { executeFinalization } from './mission-finalize'
import { finalizationFixture, setStage } from './finalization-fixture.test-support'
import { mockFinalizationGit } from './finalization-runtime.test-support'

let f: ReturnType<typeof finalizationFixture>
let git: ReturnType<typeof mockFinalizationGit>
beforeEach(() => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
  f.missions.startFinalization(f.missionId)
  git = mockFinalizationGit()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const execute = () => executeFinalization({ ...f, runtime: git.runtime }, f.missionId)
const approvals = () => f.store.listApprovals({ missionId: f.missionId })
const record = () => missionFinalization(f.store, f.missionId)

it('a ready run requests one delivery approval whose inputs hash is the report hash', async () => {
  await execute()
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  const ready = record()
  expect(ready?.outcome).toBe('ready')
  if (ready?.outcome !== 'ready') {
    throw new Error('Missing ready record')
  }
  expect(approvals()).toHaveLength(1)
  expect(approvals()[0]).toMatchObject({
    status: 'PENDING',
    actionKind: 'delivery',
    inputsHash: ready.reportSha256
  })
  await execute()
  expect(approvals()).toHaveLength(1)
})

it('a stopped run requests no approval', async () => {
  setStage(f.store, f.tasks[0].taskId, 'RUNNING')
  await execute()
  expect(record()).toMatchObject({ outcome: 'stopped', reason: 'completion_gate_failed' })
  expect(f.store.getMission(f.missionId)?.status).toBe('FINALIZING')
  expect(approvals()).toEqual([])
})

it('a request that fails leaves the Mission FINALIZING without a ready record and the next run requests the approval', async () => {
  vi.spyOn(f.store, 'insertApproval').mockImplementationOnce(() => {
    throw new Error('request refused')
  })
  await expect(execute()).rejects.toThrow('request refused')
  expect(f.store.getMission(f.missionId)?.status).toBe('FINALIZING')
  expect(record()).toBeUndefined()
  expect(approvals()).toEqual([])
  expect(
    f.store
      .listAuditEvents({ missionId: f.missionId })
      .filter((event) => event.event === 'approval.requested')
  ).toEqual([])
  await execute()
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  expect(record()?.outcome).toBe('ready')
  expect(approvals()).toHaveLength(1)
  expect(approvals()[0]?.status).toBe('PENDING')
})
