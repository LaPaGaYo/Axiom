import { afterEach, beforeEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from './axiom-store'
import { SupervisionSettingRowCodec } from './supervision-setting-rows'

let db: OrchestrationDb
let store: AxiomStore
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
})
afterEach(() => db.close())

it('validates the global setting before inserting a revision', () => {
  expect(() =>
    store.appendSupervisionSetting({ rule: 'stalled', mode: null, actor: 'user' })
  ).toThrow()
  expect(() =>
    store.appendSupervisionSetting({ rule: 'stalled', mode: 'stop', missionId: '', actor: 'user' })
  ).toThrow()
  expect(store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
})

it('allocates scope revisions and the audit watermark within the writing transaction', () => {
  const audit = () =>
    store.appendAuditEvent({
      missionId: 'mission',
      actor: 'user',
      objectKind: 'mission',
      objectId: 'mission',
      event: 'fixture.changed',
      before: null,
      after: null
    })
  const sequence = audit()
  const first = store.appendSupervisionSetting({
    rule: 'stalled',
    mode: 'notify',
    actor: 'user',
    provenance: { kind: 'user' }
  })
  expect(first).toMatchObject({
    missionId: '',
    revision: 1,
    mode: 'notify',
    auditSequence: sequence,
    provenance: { kind: 'user' }
  })
  store.transaction('fixture_revision', () => {
    const next = audit()
    expect(
      store.appendSupervisionSetting({ rule: 'stalled', mode: 'stop', actor: 'user' })
    ).toMatchObject({ revision: 2, auditSequence: next })
    expect(
      store.appendSupervisionSetting({
        rule: 'stalled',
        missionId: 'mission',
        mode: 'observe',
        actor: 'user'
      })
    ).toMatchObject({ revision: 1, auditSequence: next })
  })
  expect(store.getSupervisionSetting({ rule: 'stalled' })).toMatchObject({
    revision: 2,
    mode: 'stop'
  })
  expect(store.getSupervisionSetting({ rule: 'stalled', missionId: 'mission' })).toMatchObject({
    revision: 1,
    mode: 'observe'
  })
  expect(
    db.db
      .prepare(
        'SELECT mode, audit_sequence FROM supervision_settings WHERE mission_id = ? AND revision = 1'
      )
      .get('')
  ).toEqual(expect.objectContaining({ mode: first.mode, audit_sequence: first.auditSequence }))
})

it('rolls back a revision with its caller transaction without consuming its number', () => {
  expect(() =>
    store.transaction('fixture_rollback', () => {
      store.appendSupervisionSetting({ rule: 'stalled', mode: 'stop', actor: 'user' })
      throw new Error('rollback')
    })
  ).toThrow('rollback')
  expect(store.getSupervisionSetting({ rule: 'stalled' })).toBeUndefined()
  expect(
    store.appendSupervisionSetting({ rule: 'stalled', mode: 'notify', actor: 'user' })
  ).toMatchObject({ revision: 1, auditSequence: 0 })
})

it('rejects corrupt stored settings at the row boundary', () => {
  const row = {
    rule: 'stalled',
    mission_id: '',
    revision: 1,
    mode: 'stop',
    actor: 'user',
    provenance: '{}',
    audit_sequence: 0,
    created_at: '2026-11-12'
  }
  for (const invalid of [
    { mode: null },
    { mode: 'auto' },
    { revision: 0 },
    { provenance: 'secret-invalid-json' }
  ]) {
    expect(() => SupervisionSettingRowCodec.parse({ ...row, ...invalid })).toThrow()
  }
  expect(() =>
    SupervisionSettingRowCodec.parse({ ...row, provenance: 'secret-invalid-json' })
  ).toThrow('Invalid stored JSON in supervision_settings row 1 column provenance')
})
