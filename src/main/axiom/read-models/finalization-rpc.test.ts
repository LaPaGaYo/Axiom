import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { rpcFixture } from '../rpc-fixture.test-support'
import {
  finalizationFixture,
  integrationHead,
  targetHead
} from '../finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from '../finalization/finalization-runtime.test-support'
import { executeFinalization } from '../finalization/mission-finalize'
import { MissionResponseSchema } from '../../../shared/axiom-contract/mission-params'
import { MissionPendingResponseSchema } from '../../../shared/axiom-contract/mission-pending'

let rpc: ReturnType<typeof rpcFixture>
let f: ReturnType<typeof finalizationFixture>
let git: ReturnType<typeof mockFinalizationGit>
beforeEach(() => {
  rpc = rpcFixture()
  expect(rpc.db).toBeInstanceOf(OrchestrationDb)
  f = finalizationFixture(rpc.db)
  git = mockFinalizationGit(rpc.runtime)
})
afterEach(() => {
  rpc.db.close()
  vi.restoreAllMocks()
})
async function result(method: string) {
  const response = await rpc.call(method, { missionId: f.missionId })
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return response.result
}
const show = async () => MissionResponseSchema.parse(await result('axiom.mission.show'))
const pending = async () =>
  MissionPendingResponseSchema.parse(await result('axiom.mission.pending'))
const execute = () => executeFinalization({ ...f, runtime: rpc.runtime }, f.missionId)
function moved() {
  git.readGit
    .mockResolvedValueOnce(targetHead)
    .mockRejectedValueOnce(Object.assign(new Error('not ancestor'), { code: 1 }))
}

it('mission.show carries the finalization record of the current FINALIZING entry', async () => {
  f.missions.startFinalization(f.missionId)
  moved()
  await execute()
  expect((await show()).finalization).toMatchObject({
    outcome: 'stopped',
    reason: 'target_branch_moved',
    targetBranch: 'main',
    integrationHead,
    targetHead,
    at: expect.stringMatching(/Z$/)
  })
  f.missions.pauseMission(f.missionId)
  f.missions.resumeMission(f.missionId)
  expect(await show()).not.toHaveProperty('finalization')
  await execute()
  expect((await show()).finalization?.outcome).toBe('ready')
})
it('mission.show carries no finalization before a Mission finalizes', async () => {
  expect(await show()).not.toHaveProperty('finalization')
  f.missions.startFinalization(f.missionId)
  expect(await show()).not.toHaveProperty('finalization')
  expect(git.readHead).not.toHaveBeenCalled()
  expect(git.readGit).not.toHaveBeenCalled()
})
it('mission.pending lists a stopped finalization as a blocking mission item with cancel as its only action', async () => {
  f.missions.startFinalization(f.missionId)
  expect((await pending()).items).toEqual([])
  moved()
  await execute()
  const items = (await pending()).items
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    id: `mission:${f.missionId}`,
    kind: 'mission',
    objectId: f.missionId,
    reason: 'target_branch_moved',
    blocking: true,
    actions: ['axiom.mission.cancel'],
    since: (await show()).finalization!.at
  })
  for (const text of ['main', targetHead.slice(0, 7), integrationHead.slice(0, 7)]) {
    expect(items[0].summary).toContain(text)
  }
  f.db.createGate({ taskId: f.tasks[0].taskId, question: 'Confirm scope' })
  await execute()
  const failed = (await pending()).items.find((item) => item.kind === 'mission')!
  expect(failed.reason).toBe('completion_gate_failed')
  expect(failed.summary).toContain('no_open_questions')
})
it('mission.pending lists no finalization item once the Mission is READY_FOR_APPROVAL', async () => {
  f.missions.startFinalization(f.missionId)
  moved()
  await execute()
  await execute()
  expect(f.missions.getMission(f.missionId).status).toBe('READY_FOR_APPROVAL')
  expect((await pending()).items).toEqual([])
})
