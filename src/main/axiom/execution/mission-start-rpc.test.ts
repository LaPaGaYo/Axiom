import { afterEach, expect, it, vi } from 'vitest'
import { MissionCreateResponseSchema } from '../../../shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../../shared/axiom-contract/plan-params'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { createParams, rpcFixture } from '../rpc-fixture.test-support'
import * as integration from './integration-base'

const fixtures: ReturnType<typeof rpcFixture>[] = []
afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    f.db.close()
  }
})
function harness() {
  const f = rpcFixture()
  fixtures.push(f)
  return f
}
async function createMission(f: ReturnType<typeof rpcFixture>) {
  const result = await f.call('axiom.mission.create', createParams)
  if (!result.ok) {
    throw new Error(result.error.code)
  }
  return MissionCreateResponseSchema.parse(result.result)
}
async function approveMission(
  f: ReturnType<typeof rpcFixture>,
  created: ReturnType<typeof MissionCreateResponseSchema.parse>
) {
  const result = await f.call('axiom.plan.propose', {
    missionId: created.mission.id,
    planRevision: { ...makeProposal(), goalRevisionId: created.goalRevision.id },
    provenance
  })
  if (!result.ok) {
    throw new Error(result.error.code)
  }
  const { planRevision } = PlanResponseSchema.parse(result.result)
  const approved = await f.call('axiom.plan.approve', {
    planRevisionId: planRevision.id,
    resolver: 'test'
  })
  if (!approved.ok) {
    throw new Error(approved.error.code)
  }
}
function baseAudits(f: ReturnType<typeof rpcFixture>, missionId: string) {
  return f.store
    .listAuditEvents({ missionId })
    .filter((event) =>
      ['integration.base_created', 'integration.base_reused'].includes(event.event)
    )
}

it('checks that a Mission may start before it touches git or the audit', async () => {
  const f = harness()
  const created = await createMission(f)
  const missionId = created.mission.id
  const before = f.store.listAuditEvents({ missionId })
  const result = await f.call('axiom.mission.start', { missionId })
  expect(integration.ensureIntegrationBase).not.toHaveBeenCalled()
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'illegal_transition', data: { missionId, from: 'ANALYZING', to: 'EXECUTING' } }
  })
  expect(baseAudits(f, missionId)).toEqual([])
  expect(f.store.listAuditEvents({ missionId })).toEqual(before)
  expect(f.store.getMission(missionId)?.status).toBe('ANALYZING')

  await approveMission(f, created)
  expect(await f.call('axiom.mission.start', { missionId })).toMatchObject({ ok: true })
  const started = f.store.getMission(missionId)
  expect(await f.call('axiom.mission.start', { missionId })).toMatchObject({
    ok: false,
    error: {
      code: 'stale_state',
      data: { missionId, from: 'PLANNED', to: 'EXECUTING', actual: 'EXECUTING' }
    }
  })
  expect(integration.ensureIntegrationBase).toHaveBeenCalledTimes(1)
  expect(baseAudits(f, missionId)).toHaveLength(1)
  expect(f.store.getMission(missionId)).toEqual(started)
})

it('refuses to start a Mission whose repository is not on this machine', async () => {
  for (const host of [
    { connectionId: 'remote-fixture' },
    { executionHostId: 'runtime:elsewhere' }
  ] as const) {
    const f = harness()
    vi.mocked(f.runtime.showRepo).mockResolvedValue({
      id: 'repo-fixture',
      path: '/fixture',
      displayName: 'fixture',
      badgeColor: '',
      addedAt: 0,
      ...host
    })
    const created = await createMission(f)
    await approveMission(f, created)
    const missionId = created.mission.id
    const before = f.store.listAuditEvents({ missionId })
    expect(await f.call('axiom.mission.start', { missionId })).toMatchObject({
      ok: false,
      error: {
        code: 'repository_not_local',
        data: { missionId, repoId: 'repo-fixture', reason: expect.any(String) }
      }
    })
    expect(f.runtime.showRepo).toHaveBeenLastCalledWith('id:repo-fixture')
    expect(f.store.getMission(missionId)?.status).toBe('PLANNED')
    expect(integration.ensureIntegrationBase).not.toHaveBeenCalled()
    expect(baseAudits(f, missionId)).toEqual([])
    expect(f.store.listAuditEvents({ missionId })).toEqual(before)
  }
})

it('starts a planned Mission on a local repository with a free target as before', async () => {
  const f = harness()
  const created = await createMission(f)
  await approveMission(f, created)
  const missionId = created.mission.id
  expect(await f.call('axiom.mission.start', { missionId })).toMatchObject({
    ok: true,
    result: { mission: { status: 'EXECUTING' } }
  })
  expect(integration.ensureIntegrationBase).toHaveBeenCalledExactlyOnceWith({
    repoPath: '/fixture',
    targetBranch: 'main',
    missionId
  })
  const events = f.store.listAuditEvents({ missionId })
  const base = baseAudits(f, missionId)
  expect(base).toHaveLength(1)
  const start = events.findLast((event) => event.event === 'mission.status')
  expect(start).toMatchObject({ after: { status: 'EXECUTING' } })
  expect(base[0].sequence).toBeLessThan(start?.sequence ?? 0)
  expect(f.store.listTaskStages({ missionId, stage: 'READY' })).toHaveLength(3)
})
