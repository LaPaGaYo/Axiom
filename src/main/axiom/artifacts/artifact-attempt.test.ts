import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAppEnvironment } from '../../../shared/app-environment'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'

let root: string
let f: ReturnType<typeof channelFixture>
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-attempt-artifact-'))
  const environment = getAppEnvironment()
  const getPath = environment.getPath.bind(environment)
  vi.spyOn(environment, 'getPath').mockImplementation((name) =>
    name === 'userData' ? root : getPath(name)
  )
  f = channelFixture()
})
afterEach(async () => {
  f.db.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
function params() {
  return {
    missionId: f.mission.id,
    attemptId: f.t01.attemptId,
    from: f.t01.from,
    kind: 'worker_report',
    contentBase64: Buffer.from('report').toString('base64'),
    mediaType: 'text/plain',
    related: ['forged-task'],
    createdBy: 'user'
  }
}
it('binds artifact attribution to the authenticated Attempt and rechecks receipts', async () => {
  const input = params()
  const envelope = { orchestrationRequestId: 'artifact-once' }
  expect(await f.call('axiom.artifact.put', input, envelope)).toMatchObject({
    ok: true,
    result: {
      artifact: {
        createdBy: `attempt:${f.t01.attemptId}`,
        related: [f.t01.taskId, f.t01.attemptId]
      }
    }
  })
  f.processes.set(f.t01.from, 'new-process')
  expect(await f.call('axiom.artifact.put', input, envelope)).toMatchObject({
    ok: false,
    error: { code: 'worker_identity_changed' }
  })
})
it('rejects cross-Mission and cross-Attempt writes', async () => {
  expect(
    await f.call('axiom.artifact.put', { ...params(), missionId: 'foreign-mission' })
  ).toMatchObject({ ok: false, error: { code: 'task_dispatch_mismatch' } })
  const other = f.bind('T02')
  expect(await f.call('axiom.artifact.put', { ...params(), from: other.from })).toMatchObject({
    ok: false,
    error: { code: 'worker_identity_changed' }
  })
  expect(f.store.listArtifacts({ missionId: f.mission.id })).toEqual([])
})
it('rejects local CLI puts without an Attempt and accepts the legitimate Worker', async () => {
  const input = params()
  const call = (p: unknown) =>
    f.dispatcher.dispatch({
      id: 'artifact',
      authToken: 'test',
      method: 'axiom.artifact.put',
      params: p,
      orchestrationContractVersion: 1,
      orchestrationRequestId: 'local-artifact'
    })
  expect.soft(await call({ ...input, attemptId: undefined })).toMatchObject({
    ok: false,
    error: { code: 'caller_not_desktop' }
  })
  expect(await call(input)).toMatchObject({
    ok: true,
    result: { artifact: { createdBy: `attempt:${f.t01.attemptId}` } }
  })
})
