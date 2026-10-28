import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import { codexMissionSessionPins } from '../../codex/codex-mission-session-pins'
import { getDefaultSettings } from '../../../shared/constants'

let f: Awaited<ReturnType<typeof plannerFixture>>
const cleanup: (() => void)[] = []
beforeEach(async () => {
  f = await plannerFixture()
  vi.spyOn(f.runtime, 'requireStore')
  vi.mocked(f.runtime.requireStore, { partial: true }).mockReturnValue({
    getSettings: () => ({ ...getDefaultSettings('/fixture'), experimentalNativeChat: true })
  })
})
afterEach(async () => {
  cleanup.splice(0).forEach((dispose) => dispose())
  await f.close()
  vi.unstubAllEnvs()
})

async function prepare(inherited: NodeJS.ProcessEnv = {}) {
  const resolveBaseEnvironment = vi.fn(async () => inherited)
  await createPlannerLauncher({ ...f.deps, resolveBaseEnvironment }).start(f.mission.id)
  const hook = f.startWorker.mock.calls[0]?.[0].controlPlane?.structured?.prepare
  expect(f.startWorker.mock.calls[0]?.[0].mode?.mode).toBe('structured')
  if (!hook) {
    throw new Error('Missing Codex Planner hook')
  }
  cleanup.push(await hook({ dispatchId: 'codex-dispatch', sessionId: 'codex-session' }))
  expect(resolveBaseEnvironment).toHaveBeenCalledWith(
    expect.objectContaining({ experimentalNativeChat: true })
  )
  return codexMissionSessionPins('codex-session')
}

it('selects Codex pins for a structured Planner and audits the exact override evidence', async () => {
  vi.stubEnv('AXIOM_EGRESS_BLACKHOLE_URL', 'http://localhost:12345')
  vi.stubEnv('AXIOM_EGRESS_NO_PROXY', '')
  expect((await prepare())?.env).toMatchObject({
    HTTPS_PROXY: 'http://localhost:12345',
    NO_PROXY: '',
    no_proxy: ''
  })
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'attempt.egress_pinned')
  ).toMatchObject([
    {
      actor: 'MissionController',
      objectKind: 'attempt',
      objectId: 'codex-dispatch',
      after: {
        provider: 'codex',
        channel: 'structured',
        mode: 'allowlist',
        blackhole: 'http://localhost:12345',
        noProxy: [],
        overrides: ['AXIOM_EGRESS_BLACKHOLE_URL', 'AXIOM_EGRESS_NO_PROXY']
      }
    }
  ])
})

it('leaves inherited proxies untouched and absent from pins and evidence', async () => {
  expect((await prepare({ ALL_PROXY: 'private-inherited-proxy' }))?.env).toEqual({})
  const evidence = f.store
    .listAuditEvents({ missionId: f.mission.id })
    .filter((e) => e.event === 'attempt.egress_pinned')
  expect(evidence).toMatchObject([
    {
      after: {
        provider: 'codex',
        mode: 'inherited-proxy',
        blackhole: null,
        noProxy: [],
        overrides: []
      }
    }
  ])
  expect(JSON.stringify(evidence)).not.toContain('private-inherited-proxy')
})

it('records the terminal gap when the kernel downgrades a structured preference', async () => {
  const start = f.startWorker.getMockImplementation()
  if (!start) {
    throw new Error('Missing fixture worker start')
  }
  f.startWorker.mockImplementationOnce(async (args) => ({
    ...(await start(args)),
    mode: { mode: 'terminal' }
  }))
  const resolveBaseEnvironment = vi.fn(async () => ({}))
  await createPlannerLauncher({ ...f.deps, resolveBaseEnvironment }).start(f.mission.id)
  expect(f.startWorker.mock.calls[0]?.[0].mode?.mode).toBe('structured')
  expect(resolveBaseEnvironment).not.toHaveBeenCalled()
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'attempt.egress_pinned',
      objectId: f.store.listPlannerBindings(f.mission.id)[0]?.dispatchId,
      after: {
        provider: 'codex',
        channel: 'terminal',
        mode: 'unpinned-terminal',
        noProxy: [],
        blackhole: null,
        overrides: []
      }
    })
  )
})
