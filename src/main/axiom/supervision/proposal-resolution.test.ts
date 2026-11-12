import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAxiomControlPlane } from '../control-plane'
import {
  stallEvidenceFixture,
  recordStallEvidence
} from '../recovery/stall-evidence-fixture.test-support'

let f: ReturnType<typeof stallEvidenceFixture>
let proposalId: string
beforeEach(async () => {
  f = stallEvidenceFixture()
  f.samples(20)
  await f.tick()
  const proposal = f.proposals()[0]
  if (!proposal) {
    throw new Error('Missing proposal')
  }
  proposalId = proposal.id
})
afterEach(() => {
  f.cleanup()
})

it('accepts a proposal into a new global revision', async () => {
  const before = f.proposals()[0]
  expect(await f.resolve(proposalId, 'accept')).toMatchObject({
    ok: true,
    result: {
      rules: [{ globalMode: 'notify', globalSource: 'proposal' }],
      proposals: [
        { id: proposalId, status: 'ACCEPTED', resolver: 'user', resolvedAt: expect.any(String) }
      ],
      evidence: [{ window: { known: 0, hitRate: null } }]
    }
  })
  const revision = f.store.getSupervisionSetting({ rule: 'stalled' })
  expect(revision).toMatchObject({
    mode: 'notify',
    revision: 1,
    actor: 'user',
    provenance: { kind: 'proposal', proposalId }
  })
  recordStallEvidence('accepted-proposal', {
    before,
    after: f.proposals()[0],
    revision,
    show: await f.show()
  })
})

it('dismisses a proposal and restarts the count', async () => {
  f.samples(2)
  await f.tick()
  const through = f.proposals()[0]?.through_sequence
  expect(await f.resolve(proposalId, 'dismiss')).toMatchObject({
    ok: true,
    result: {
      rules: [{ globalMode: 'observe', globalSource: 'built_in' }],
      evidence: [{ window: { known: 2, sinceSequence: through }, total: { known: 22 } }],
      proposals: [{ status: 'DISMISSED', resolver: 'user', resolvedAt: expect.any(String) }]
    }
  })
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
  await f.tick()
  expect(f.proposals()).toHaveLength(1)
  f.samples(18)
  await f.tick()
  expect(f.proposals()).toHaveLength(2)
})

it('supersedes an open proposal when a person changes the global mode', async () => {
  await f.update('stop', f.missionId)
  expect(f.proposals()[0]?.status).toBe('OPEN')
  expect(await f.update('stop')).toMatchObject({
    ok: true,
    result: {
      rules: [{ globalMode: 'stop', globalSource: 'user' }],
      proposals: [{ status: 'SUPERSEDED', resolver: 'user', resolvedAt: expect.any(String) }]
    }
  })
})

it('refuses to accept a proposal whose starting mode changed', async () => {
  f.store.appendSupervisionSetting({
    rule: 'stalled',
    mode: 'stop',
    actor: 'user',
    provenance: { kind: 'user' }
  })
  const before = f.proposals()
  const revision = f.store.getSupervisionSetting({ rule: 'stalled' })
  expect(await f.resolve(proposalId, 'accept')).toMatchObject({
    ok: false,
    error: { code: 'stale_state' }
  })
  expect(f.proposals()).toEqual(before)
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })).toEqual(revision)
})

it('refuses proposal answers from outside the desktop app', async () => {
  const before = f.proposals()
  expect(
    await f.dispatcher.dispatch(
      {
        id: randomUUID(),
        method: 'axiom.supervision.resolve',
        authToken: 'test-caller',
        orchestrationContractVersion: 1,
        orchestrationRequestId: randomUUID(),
        params: { proposalId, resolution: 'accept' }
      },
      { caller: { kind: 'local-cli' } }
    )
  ).toMatchObject({ ok: false, error: { code: 'caller_not_desktop' } })
  expect(f.proposals()).toEqual(before)
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
})

it('rejects unknown and resolved proposals without changing durable rows', async () => {
  expect(await f.resolve('missing', 'accept')).toMatchObject({
    ok: false,
    error: { code: 'invalid_argument' }
  })
  expect(await f.resolve(proposalId, 'dismiss')).toMatchObject({ ok: true })
  const before = f.proposals()
  expect(await f.resolve(proposalId, 'accept')).toMatchObject({
    ok: false,
    error: { code: 'illegal_transition' }
  })
  expect(f.proposals()).toEqual(before)
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
})

it('rolls back the answer when the setting append fails', async () => {
  const before = f.proposals()
  vi.spyOn(getAxiomControlPlane(f.runtime).store, 'appendSupervisionSetting').mockImplementation(
    () => {
      throw new Error('Fixture revision failure')
    }
  )
  expect(await f.resolve(proposalId, 'accept')).toMatchObject({ ok: false })
  expect(f.proposals()).toEqual(before)
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
})

it('requires the mutation fence and replays an answer without a second revision', async () => {
  const params = { proposalId, resolution: 'accept' }
  expect(
    await f.call('axiom.supervision.resolve', params, { orchestrationContractVersion: undefined })
  ).toMatchObject({ ok: false, error: { code: 'orchestration_migration_required' } })
  const envelope = { orchestrationRequestId: randomUUID() }
  expect(await f.call('axiom.supervision.resolve', params, envelope)).toMatchObject({ ok: true })
  expect(await f.call('axiom.supervision.resolve', params, envelope)).toMatchObject({
    ok: true,
    result: { mutation: { replayed: true } }
  })
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })?.revision).toBe(1)
})

it('rolls back both the revision and proposal if resolution persistence fails', async () => {
  const store = getAxiomControlPlane(f.runtime).store
  const resolve = store.resolveSupervisionProposal.bind(store)
  vi.spyOn(store, 'resolveSupervisionProposal').mockImplementation((input) => {
    resolve(input)
    throw new Error('Fixture failure after resolution write')
  })
  const before = f.proposals()
  expect(await f.resolve(proposalId, 'accept')).toMatchObject({ ok: false })
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
  expect(f.proposals()).toEqual(before)
  expect(await f.update('stop')).toMatchObject({ ok: false })
  expect(f.store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
  expect(f.proposals()).toEqual(before)
})

it('returns the open proposal and only the five most recent resolved proposals', async () => {
  const resolved: string[] = []
  for (let i = 0; i < 7; i++) {
    const proposal = f.proposals().find((row) => row.status === 'OPEN')
    if (!proposal) {
      throw new Error('Missing open proposal')
    }
    resolved.push(proposal.id)
    expect(await f.resolve(proposal.id, 'dismiss')).toMatchObject({
      ok: true,
      result: {
        evidence: [{ window: { known: 0, hitRate: null, throughSequence: 0 } }]
      }
    })
    f.samples(20)
    await f.tick()
  }
  const open = f.proposals().find((row) => row.status === 'OPEN')
  expect(await f.show()).toMatchObject({
    ok: true,
    result: {
      proposals: [
        { id: open?.id, status: 'OPEN' },
        ...resolved
          .slice(-5)
          .toReversed()
          .map((id) => ({ id, status: 'DISMISSED' }))
      ]
    }
  })
})
