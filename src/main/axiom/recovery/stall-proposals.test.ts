import { afterEach, beforeEach, expect, it } from 'vitest'
import { stallEvidenceFixture, recordStallEvidence } from './stall-evidence-fixture.test-support'

let f: ReturnType<typeof stallEvidenceFixture>
beforeEach(() => {
  f = stallEvidenceFixture()
})
afterEach(() => {
  f.cleanup()
})

it('proposes the next tier after twenty known outcomes with at least ninety percent hits', async () => {
  f.samples(18, 2, 3)
  await f.tick()
  const through = f.reconciled().at(-1)?.sequence
  expect(f.proposals()).toMatchObject([
    {
      status: 'OPEN',
      from_mode: 'observe',
      to_mode: 'notify',
      since_sequence: 0,
      through_sequence: through
    }
  ])
  expect(JSON.parse(f.proposals()[0]?.evidence ?? '{}')).toEqual({
    hits: 18,
    falsePositives: 2,
    known: 20,
    inconclusive: 3,
    hitRate: 0.9,
    savedMs: 18 * 120_000,
    sinceSequence: 0,
    throughSequence: through
  })
  await f.update('notify')
  f.samples(20)
  await f.tick()
  expect(f.proposals().at(-1)).toMatchObject({
    status: 'OPEN',
    from_mode: 'notify',
    to_mode: 'stop'
  })
})

it('does not propose below the bar or when the global mode is stop', async () => {
  f.samples(17, 2)
  await f.tick()
  expect(f.proposals()).toEqual([])
  f.samples(0, 1)
  await f.tick()
  expect(f.proposals()).toEqual([])
  await f.update('stop')
  f.samples(20)
  await f.tick()
  expect(f.proposals()).toEqual([])
})

it('counts evidence only after the latest global decision', async () => {
  f.samples(10)
  await f.tick()
  const before = f.reconciled().at(-1)?.sequence
  await f.update('notify')
  f.samples(2, 1, 1)
  await f.tick()
  const after = f.reconciled().at(-1)?.sequence
  await f.update('stop', f.missionId)
  expect(await f.show()).toMatchObject({
    ok: true,
    result: {
      evidence: [
        {
          rule: 'stalled',
          window: {
            hits: 2,
            falsePositives: 1,
            known: 3,
            inconclusive: 1,
            hitRate: 2 / 3,
            savedMs: 240_000,
            sinceSequence: before,
            throughSequence: after
          },
          total: {
            hits: 12,
            falsePositives: 1,
            known: 13,
            inconclusive: 1,
            sinceSequence: 0,
            throughSequence: after
          }
        }
      ]
    }
  })
})

it('keeps at most one open proposal', async () => {
  f.samples(20)
  await f.tick()
  const first = f.proposals()
  f.samples(20)
  await f.tick()
  await f.tick()
  expect(f.proposals()).toEqual(first)
})

it('lists the evidence and the proposals in the show view', async () => {
  expect(await f.show()).toMatchObject({
    ok: true,
    result: {
      evidence: [
        {
          rule: 'stalled',
          window: { known: 0, hitRate: null, sinceSequence: 0, throughSequence: 0 },
          total: { known: 0, savedMs: 0 }
        }
      ],
      proposals: []
    }
  })
  f.samples(20)
  await f.tick()
  const proposal = f.proposals()[0]
  expect(proposal).toBeDefined()
  const shown = await f.show()
  expect(shown).toMatchObject({
    ok: true,
    result: {
      evidence: [
        { rule: 'stalled', window: { known: 20, hitRate: 1 }, total: { known: 20, hitRate: 1 } }
      ],
      proposals: [
        {
          id: proposal?.id,
          rule: 'stalled',
          fromMode: 'observe',
          toMode: 'notify',
          status: 'OPEN',
          evidence: { known: 20, hitRate: 1 },
          resolver: null,
          resolvedAt: null,
          createdAt: expect.any(String)
        }
      ]
    }
  })
  recordStallEvidence('show', shown)
})
