import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createParams, rpcFixture } from './rpc-fixture.test-support'
import { getAxiomControlPlane } from './control-plane'
import { PolicySchema } from '../../shared/axiom-contract/mission-objects'

let f: ReturnType<typeof rpcFixture>
let missionId: string
beforeEach(async () => {
  f = rpcFixture()
  const created = await f.call('axiom.mission.create', {
    ...createParams,
    policy: { ...createParams.policy, budget: { contextTokens: 5000 } }
  })
  if (!created.ok) {
    throw new Error(created.error.code)
  }
  missionId = f.store.listMissions({})[0].id
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
})
const updates = () =>
  f.store.listAuditEvents({ missionId }).filter((row) => row.event === 'policy.updated')

describe('Mission policy RPC', () => {
  it('refuses VERIFIED policy defaults at update and creation without writes', async () => {
    const before = f.store.getPolicy(missionId)
    const refused = {
      ok: false,
      error: { code: 'invalid_argument', data: { reason: 'threshold_not_supported' } }
    }
    expect
      .soft(
        await f.call('axiom.policy.update', {
          missionId,
          patch: { readinessThreshold: 'VERIFIED' }
        })
      )
      .toMatchObject(refused)
    expect
      .soft(
        await f.call('axiom.mission.create', {
          ...createParams,
          policy: { ...createParams.policy, readinessThreshold: 'VERIFIED' }
        })
      )
      .toMatchObject(refused)
    expect(f.store.getPolicy(missionId)).toEqual(before)
    expect(f.store.listMissions({})).toHaveLength(1)
    expect(updates()).toEqual([])
    expect(
      await f.call('axiom.policy.update', {
        missionId,
        patch: { readinessThreshold: 'INTEGRATED' }
      })
    ).toMatchObject({ ok: true })
  })
  it('replaces verification rules atomically and rejects unknown keys and bad types', async () => {
    expect(
      await f.call('axiom.policy.update', {
        missionId,
        patch: { verificationRules: { setupCommands: ['node --version'] } }
      })
    ).toMatchObject({
      ok: true,
      result: {
        policy: { verificationRules: { setupCommands: ['node --version'], timeBudgetMinutes: 30 } }
      }
    })
    expect(
      await f.call('axiom.policy.update', {
        missionId,
        patch: { verificationRules: { timeBudgetMinutes: 1 } }
      })
    ).toMatchObject({
      ok: true,
      result: { policy: { verificationRules: { setupCommands: [], timeBudgetMinutes: 1 } } }
    })
    const before = f.store.getPolicy(missionId)
    for (const verificationRules of [{ commands: [] }, { setupCommands: 4 }]) {
      expect(
        await f.call('axiom.policy.update', { missionId, patch: { verificationRules } })
      ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    }
    expect(f.store.getPolicy(missionId)).toEqual(before)
    expect(updates()).toHaveLength(2)
  })
  it('shows defaults and preserves contextTokens set at mission create', async () => {
    expect(
      await f.call('axiom.policy.show', { missionId }, { orchestrationContractVersion: undefined })
    ).toMatchObject({
      ok: true,
      result: {
        policy: {
          budget: { contextTokens: 5000 },
          routing: { preferredProviders: [], highRiskTier: 'A' }
        }
      }
    })
    expect(f.store.getContextTokenBudget(missionId)).toBe(5000)
    expect(await f.call('axiom.policy.show', { missionId: 'absent' })).toMatchObject({
      ok: false,
      error: { code: 'mission_not_found' }
    })
  })
  it('updates routing and concurrency atomically with before/after audit and replay', async () => {
    const before = f.store.getPolicy(missionId)!
    const patch = {
      routing: {
        preferredProviders: ['gemini'],
        disallowedProviders: ['codex'],
        models: { gemini: 'chosen-model' }
      },
      concurrencyLimit: 2
    }
    const envelope = { orchestrationRequestId: 'policy-update-once' }
    const first = await f.call('axiom.policy.update', { missionId, patch }, envelope)
    expect(first).toMatchObject({
      ok: true,
      result: { policy: { ...patch, budget: before.budget } }
    })
    expect(await f.call('axiom.policy.update', { missionId, patch }, envelope)).toMatchObject({
      ok: true,
      result: { mutation: { replayed: true } }
    })
    const after = f.store.getPolicy(missionId)
    expect(after).toEqual(PolicySchema.parse({ ...before, ...patch }))
    expect(updates()).toHaveLength(1)
    expect(updates()[0]).toMatchObject({ before, after })
    expect(
      await f.call('axiom.policy.update', { missionId, patch: { concurrencyLimit: 1 } }, envelope)
    ).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
  })
  it('refuses every budget key with approval_required without changes', async () => {
    const before = f.store.getPolicy(missionId)
    for (const budget of [{ maxRuntimeMinutes: 1 }, {}, null, 100]) {
      expect(
        await f.call('axiom.policy.update', { missionId, patch: { budget, concurrencyLimit: 1 } })
      ).toMatchObject({ ok: false, error: { code: 'approval_required' } })
    }
    expect(f.store.getPolicy(missionId)).toEqual(before)
    expect(updates()).toEqual([])
  })
  it('rejects unknown keys, invalid providers and concurrency; enforces the mutation fence', async () => {
    for (const patch of [
      { unexpected: true },
      { routing: { preferredProviders: ['unknown'] } },
      { routing: { highRiskTier: 'B' } },
      { concurrencyLimit: 0 }
    ]) {
      expect(await f.call('axiom.policy.update', { missionId, patch })).toMatchObject({
        ok: false,
        error: { code: 'invalid_argument' }
      })
    }
    expect(
      await f.call(
        'axiom.policy.update',
        { missionId, patch: { concurrencyLimit: 1 } },
        { orchestrationContractVersion: undefined }
      )
    ).toMatchObject({ ok: false, error: { code: 'orchestration_migration_required' } })
    expect(updates()).toEqual([])
  })
  it('rolls back policy changes if the audit cannot be written', async () => {
    const before = f.store.getPolicy(missionId)
    vi.spyOn(getAxiomControlPlane(f.runtime).store, 'appendAuditEvent').mockImplementation(() => {
      throw new Error('audit unavailable')
    })
    expect(
      await f.call('axiom.policy.update', { missionId, patch: { concurrencyLimit: 1 } })
    ).toMatchObject({ ok: false })
    expect(f.store.getPolicy(missionId)).toEqual(before)
    expect(updates()).toEqual([])
  })
})
