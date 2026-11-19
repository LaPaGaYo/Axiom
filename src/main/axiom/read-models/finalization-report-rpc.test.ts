import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { rpcFixture } from '../rpc-fixture.test-support'
import { finalizationFixture, facts } from '../finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from '../finalization/finalization-runtime.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { MissionResponseSchema } from '../../../shared/axiom-contract/mission-params'
import { ArtifactReadResponseSchema } from '../../../shared/axiom-contract/artifact-params'
import {
  CompletionReportSchema,
  completionReportText
} from '../../../shared/axiom-contract/completion-report'
import { buildCompletionReport } from '../finalization/completion-report'
import { sha256 } from '../artifacts/artifact-store'

let rpc: ReturnType<typeof rpcFixture>
let f: ReturnType<typeof finalizationFixture>
let plane: ReturnType<typeof getAxiomControlPlane>
beforeEach(() => {
  rpc = rpcFixture()
  f = finalizationFixture(rpc.db)
  mockFinalizationGit(rpc.runtime)
  plane = getAxiomControlPlane(rpc.runtime)
})
afterEach(async () => {
  await plane.effects.stop()
  rpc.db.close()
  vi.restoreAllMocks()
})

it('mission.show carries the report id of a ready Mission and artifact.read returns those bytes', async () => {
  f.missions.startFinalization(f.missionId)
  plane.store.transaction('test_report', () =>
    plane.effects.enqueue({
      kind: 'mission.finalize',
      missionId: f.missionId,
      key: f.missionId,
      payload: {}
    })
  )
  plane.effects.start()
  await plane.effects.kick()
  await plane.effects.stop()
  const shown = await rpc.call('axiom.mission.show', { missionId: f.missionId })
  expect(shown.ok).toBe(true)
  if (!shown.ok) {
    throw new Error(shown.error.code)
  }
  const ready = MissionResponseSchema.parse(shown.result)
  expect(ready.mission.status).toBe('READY_FOR_APPROVAL')
  expect(ready.finalization).toHaveProperty('reportArtifactId', expect.any(String))
  if (ready.finalization?.outcome !== 'ready' || !ready.finalization.reportArtifactId) {
    throw new Error('Missing report')
  }
  const read = await rpc.call('axiom.artifact.read', { id: ready.finalization.reportArtifactId })
  expect(read.ok).toBe(true)
  if (!read.ok) {
    throw new Error(read.error.code)
  }
  const { meta, contentBase64 } = ArtifactReadResponseSchema.parse(read.result)
  const bytes = Buffer.from(contentBase64, 'base64')
  expect(sha256(bytes)).toBe(ready.finalization.reportSha256)
  expect(meta.id).toBe(ready.finalization.reportArtifactId)
  expect(CompletionReportSchema.parse(JSON.parse(bytes.toString('utf8'))).mission.id).toBe(
    f.missionId
  )
  expect(bytes.toString('utf8')).toBe(
    completionReportText(buildCompletionReport(f.store, f.db, f.missionId, facts))
  )
})

it('artifact.put refuses the kind completion_report', async () => {
  const put = vi.spyOn(plane.artifacts, 'put')
  const response = await rpc.call('axiom.artifact.put', {
    missionId: f.missionId,
    kind: 'completion_report',
    mediaType: 'application/json',
    related: [f.missionId],
    createdBy: 'worker',
    contentBase64: Buffer.from('{}').toString('base64')
  })
  expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  expect(put).not.toHaveBeenCalled()
  expect(f.store.listArtifacts({ missionId: f.missionId })).toEqual([])
})
