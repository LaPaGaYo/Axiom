import { expect, it } from 'vitest'
import { MissionFinalizationSchema, FINALIZATION_GATE_IDS } from './mission-finalization'

it('a stopped record needs a reason and a ready record refuses one', () => {
  const base = { targetBranch: 'main', at: '2026-11-18T12:00:00Z' }
  expect(MissionFinalizationSchema.safeParse({ ...base, outcome: 'stopped' }).success).toBe(false)
  expect(
    MissionFinalizationSchema.parse({ ...base, outcome: 'stopped', reason: 'target_branch_moved' })
  ).toMatchObject({ reason: 'target_branch_moved' })
  expect(MissionFinalizationSchema.parse({ ...base, outcome: 'ready' })).toMatchObject({
    outcome: 'ready'
  })
  expect(
    MissionFinalizationSchema.safeParse({
      ...base,
      outcome: 'ready',
      reason: 'target_branch_moved'
    }).success
  ).toBe(false)
  const gate = FINALIZATION_GATE_IDS.map((id) => ({ id, pass: true, evidence: [] }))
  expect(MissionFinalizationSchema.safeParse({ ...base, outcome: 'ready', gate }).success).toBe(
    true
  )
  for (const invalid of [
    gate.slice(1),
    gate.toReversed(),
    gate.map((item) => ({ ...item, evidence: [''] })),
    gate.map((item) => ({ ...item, evidence: Array(201).fill('id') }))
  ]) {
    expect(
      MissionFinalizationSchema.safeParse({ ...base, outcome: 'ready', gate: invalid }).success
    ).toBe(false)
  }
  expect(
    MissionFinalizationSchema.safeParse({ ...base, outcome: 'ready', targetHead: 'invalid' })
      .success
  ).toBe(false)
  expect(
    MissionFinalizationSchema.safeParse({
      ...base,
      outcome: 'ready',
      at: '2026-11-18T12:00:00+01:00'
    }).success
  ).toBe(false)
})
