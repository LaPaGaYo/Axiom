import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createParams, rpcFixture } from './rpc-fixture.test-support'
import { getAxiomControlPlane } from './control-plane'
import * as detection from '../preflight/agent-detection'
import { PolicyResponseSchema, PolicyUpdateParams } from '../../shared/axiom-contract/policy-params'
import { AgentFactoryError } from './agent-factory/agent-factory'
import { ProviderFilterReasonSchema } from '../../shared/axiom-contract/agent-spec'
import { TuiAgentIdSchema } from '../../shared/axiom-contract/mission-objects'

let f: ReturnType<typeof rpcFixture>
let missionId: string
beforeEach(async () => {
  f = rpcFixture()
  const created = await f.call('axiom.mission.create', createParams)
  expect(created.ok).toBe(true)
  missionId = f.store.listMissions({})[0].id
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
})

it('answers the providers only when the caller asks', async () => {
  const installed = vi.spyOn(detection, 'detectInstalledAgentsWithShellPathHydration')
  const plane = getAxiomControlPlane(f.runtime)
  const cooling = vi.spyOn(plane.agentFactory, 'accountCooldown')
  for (const params of [{ missionId }, { missionId, providers: false }]) {
    const response = await f.call('axiom.policy.show', params)
    expect(response).toMatchObject({ ok: true, result: { policy: f.store.getPolicy(missionId) } })
    if (!response.ok) {
      throw new Error(response.error.code)
    }
    expect(response.result).not.toHaveProperty('providers')
  }
  expect(installed).not.toHaveBeenCalled()
  expect(cooling).not.toHaveBeenCalled()
  const response = await f.call('axiom.policy.show', { missionId, providers: true })
  expect(response).toMatchObject({ ok: true, result: { providers: expect.any(Array) } })
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  expect(installed).toHaveBeenCalledOnce()
  expect(cooling).toHaveBeenCalledOnce()
  const answer = PolicyResponseSchema.parse(response.result)
  expect(answer.providers).toEqual(await plane.agentFactory.providerEligibility(missionId))
})

it('names the reasons selection gives when no provider is eligible', async () => {
  vi.spyOn(detection, 'detectInstalledAgentsWithShellPathHydration').mockResolvedValue(['codex'])
  vi.spyOn(f.runtime, 'resolveCodexHomeForWorkerLaunch').mockReturnValue('/policy-fixture-account')
  const plane = getAxiomControlPlane(f.runtime)
  const policy = f.store.getPolicy(missionId)!
  f.store.upsertPolicy(missionId, {
    ...policy,
    routing: { ...policy.routing, disallowedProviders: ['codex'] }
  })
  const result = await plane.agentFactory
    .build({
      missionId,
      role: 'planner',
      goalRevisionId: f.store.getMission(missionId)!.activeGoalRevisionId!
    })
    .catch((error: unknown) => error)
  expect(result).toBeInstanceOf(AgentFactoryError)
  if (!(result instanceof AgentFactoryError)) {
    throw new Error('expected selection refusal')
  }
  expect(result.code).toBe('no_eligible_provider')
  const filtered = z
    .array(z.strictObject({ provider: TuiAgentIdSchema, reason: ProviderFilterReasonSchema }))
    .parse(result.data.filtered)
  expect(filtered.length).toBeGreaterThan(0)
  expect(filtered).toContainEqual({ provider: 'codex', reason: 'disallowed' })
  const response = await f.call('axiom.policy.show', { missionId, providers: true })
  expect(response).toMatchObject({ ok: true, result: { providers: expect.any(Array) } })
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  const answer = PolicyResponseSchema.parse(response.result)
  for (const { provider, reason } of filtered) {
    expect(answer.providers?.find((entry) => entry.provider === provider)?.planner).toEqual({
      eligible: false,
      reason
    })
  }
})

it('hands the update to the controller and answers what it returns', async () => {
  const plane = getAxiomControlPlane(f.runtime)
  expect(plane.missions.updatePolicy).toBeTypeOf('function')
  const operation = vi.spyOn(plane.missions, 'updatePolicy')
  const params = {
    missionId,
    patch: { concurrencyLimit: 2, routing: { preferredProviders: ['codex'] } }
  }
  const response = await f.call('axiom.policy.update', params)
  expect(operation).toHaveBeenCalledExactlyOnceWith(PolicyUpdateParams.parse(params))
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  expect(response.result).toMatchObject(operation.mock.results[0].value)
})

it('keeps the providers flag out of an update and refuses a Mission that does not exist', async () => {
  expect(
    await f.call('axiom.policy.update', {
      missionId,
      providers: true,
      patch: { concurrencyLimit: 2 }
    })
  ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  expect(await f.call('axiom.policy.show', { missionId: 'absent', providers: true })).toMatchObject(
    { ok: false, error: { code: 'mission_not_found' } }
  )
})
