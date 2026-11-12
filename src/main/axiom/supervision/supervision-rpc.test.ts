import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createParams, rpcFixture } from '../rpc-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'

let f: ReturnType<typeof rpcFixture>
let missionId: string
beforeEach(async () => {
  f = rpcFixture()
  expect(await f.call('axiom.mission.create', createParams)).toMatchObject({ ok: true })
  const mission = f.store.listMissions({})[0]
  if (!mission) {
    throw new Error('Missing fixture Mission')
  }
  missionId = mission.id
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
})
const update = (mode: string | null, scope?: string) =>
  f.call('axiom.supervision.update', { rule: 'stalled', mode, missionId: scope })
const rows = () =>
  f.db.db.prepare('SELECT * FROM supervision_settings ORDER BY mission_id, revision').all()
const audits = () =>
  f.store.listAuditEvents({ missionId }).filter((row) => row.event === 'supervision.updated')

it('uses observe as the global stall mode until a person changes it', async () => {
  expect(await f.call('axiom.supervision.show', {})).toMatchObject({
    ok: true,
    result: {
      rules: [{ rule: 'stalled', globalMode: 'observe', globalSource: 'built_in' }],
      notifications: []
    }
  })
  expect(await update('notify')).toMatchObject({
    ok: true,
    result: {
      rules: [{ rule: 'stalled', globalMode: 'notify', globalSource: 'user' }],
      notifications: []
    }
  })
  expect(audits()).toEqual([])
})

it('applies a Mission stall mode over the global default', async () => {
  await update('notify')
  expect(await update('stop', missionId)).toMatchObject({
    ok: true,
    result: { rules: [{ globalMode: 'notify', missionMode: 'stop', effectiveMode: 'stop' }] }
  })
  if (process.env.AXIOM_SUPERVISION_TEST_EVIDENCE === '1') {
    writeFileSync(
      path.join(
        process.env.AXIOM_SUPERVISION_EVIDENCE_DIRECTORY ?? '/tmp',
        'axiom-stall-revisions.json'
      ),
      JSON.stringify(rows(), null, 2)
    )
  }
  await update('observe')
  expect(await f.call('axiom.supervision.show', { missionId })).toMatchObject({
    ok: true,
    result: { rules: [{ globalMode: 'observe', missionMode: 'stop', effectiveMode: 'stop' }] }
  })
})

it('keeps every stall mode change as a new revision', async () => {
  const sequence = f.store.listAuditEvents({ missionId }).at(-1)?.sequence
  await update('notify')
  const first = rows()[0]
  expect(first).toMatchObject({
    rule: 'stalled',
    mission_id: '',
    revision: 1,
    mode: 'notify',
    actor: 'user',
    provenance: '{"kind":"user"}',
    audit_sequence: sequence
  })
  await update('stop')
  await update('stop', missionId)
  await update('notify', missionId)
  expect(rows()).toMatchObject([
    first,
    { mission_id: '', revision: 2, mode: 'stop' },
    { mission_id: missionId, revision: 1, mode: 'stop' },
    { mission_id: missionId, revision: 2, mode: 'notify' }
  ])
})

it('clears a Mission stall mode back to the global default', async () => {
  await update('notify')
  await update('stop', missionId)
  expect(await update(null, missionId)).toMatchObject({
    ok: true,
    result: { rules: [{ globalMode: 'notify', missionMode: null, effectiveMode: 'notify' }] }
  })
  expect(rows()).toMatchObject([
    { mission_id: '', revision: 1, mode: 'notify' },
    { mission_id: missionId, revision: 1, mode: 'stop' },
    { mission_id: missionId, revision: 2, mode: null }
  ])
  await update('stop')
  expect(await f.call('axiom.supervision.show', { missionId })).toMatchObject({
    ok: true,
    result: { rules: [{ missionMode: null, effectiveMode: 'stop' }] }
  })
})

it('refuses to clear the global stall mode', async () => {
  expect(await update(null)).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  expect(rows()).toEqual([])
  expect(audits()).toEqual([])
})

it('refuses stall mode changes from outside the desktop app', async () => {
  expect(
    await f.dispatcher.dispatch(
      {
        id: randomUUID(),
        method: 'axiom.supervision.update',
        authToken: 'test-caller',
        orchestrationContractVersion: 1,
        orchestrationRequestId: randomUUID(),
        params: { rule: 'stalled', mode: 'stop', missionId }
      },
      { caller: { kind: 'local-cli' } }
    )
  ).toMatchObject({ ok: false, error: { code: 'caller_not_desktop' } })
  expect(rows()).toEqual([])
})

it('audits a Mission stall mode change on that Mission', async () => {
  await update('stop', missionId)
  await update(null, missionId)
  expect(audits()).toMatchObject([
    {
      actor: 'user',
      objectKind: 'mission',
      objectId: missionId,
      after: { rule: 'stalled', before: null, after: 'stop' }
    },
    {
      actor: 'user',
      objectKind: 'mission',
      objectId: missionId,
      after: { rule: 'stalled', before: 'stop', after: null }
    }
  ])
})

it('writes no setting revision or audit for an unchanged scope', async () => {
  await update('observe')
  await update(null, missionId)
  expect(rows()).toEqual([])
  await update('observe', missionId)
  const before = rows()
  await update('observe', missionId)
  expect(rows()).toEqual(before)
  expect(audits()).toHaveLength(1)
})

it('rejects invalid settings and missing Missions without writes', async () => {
  for (const params of [
    { rule: 'timeout', mode: 'stop' },
    { rule: 'stalled', mode: 'auto' },
    { rule: 'stalled', mode: 'stop', missionId: '' },
    { rule: 'stalled', mode: 'stop', actor: 'user' }
  ]) {
    expect(await f.call('axiom.supervision.update', params)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
  }
  expect(await update('stop', 'missing')).toMatchObject({
    ok: false,
    error: { code: 'mission_not_found' }
  })
  expect(await f.call('axiom.supervision.show', { missionId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'mission_not_found' }
  })
  expect(rows()).toEqual([])
  expect(audits()).toEqual([])
})

it('rolls back the setting revision when its Mission audit fails', async () => {
  vi.spyOn(getAxiomControlPlane(f.runtime).store, 'appendAuditEvent').mockImplementation(() => {
    throw new Error('audit unavailable')
  })
  expect(await update('stop', missionId)).toMatchObject({ ok: false })
  expect(rows()).toEqual([])
})

it('fences and replays supervision mutations while reads need no mutation envelope', async () => {
  const params = { rule: 'stalled', mode: 'stop', missionId }
  expect(
    await f.call('axiom.supervision.update', params, { orchestrationContractVersion: undefined })
  ).toMatchObject({ ok: false, error: { code: 'orchestration_migration_required' } })
  const envelope = { orchestrationRequestId: randomUUID() }
  expect(await f.call('axiom.supervision.update', params, envelope)).toMatchObject({ ok: true })
  expect(await f.call('axiom.supervision.update', params, envelope)).toMatchObject({
    ok: true,
    result: { mutation: { replayed: true } }
  })
  expect(rows()).toHaveLength(1)
  expect(audits()).toHaveLength(1)
  expect(
    await f.call('axiom.supervision.show', {}, { orchestrationContractVersion: undefined })
  ).toMatchObject({ ok: true })
})
