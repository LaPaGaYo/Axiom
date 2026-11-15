import { expect, it } from 'vitest'
import { AxiomRpcError } from '@/lib/axiom-rpc-call'
import { missionErrorText } from './mission-error-text'

it('reads refusal details defensively and preserves first message order', () => {
  expect(
    missionErrorText(
      new AxiomRpcError('refused', 'refused', {
        errors: [
          null,
          { message: 3 },
          'text',
          { message: 'B' },
          { message: 'A' },
          { message: 'B' }
        ],
        reason: 'unused'
      })
    )
  ).toBe('refused: B A')
  expect(
    missionErrorText(
      new AxiomRpcError('refused', 'refused', {
        errors: [{ message: '' }],
        reason: 'unused'
      })
    )
  ).toBe('refused: ')
  for (const errors of [undefined, null, 'invalid', [], [{ message: 3 }]]) {
    expect(
      missionErrorText(new AxiomRpcError('refused', 'refused', { errors, reason: 'reason' }))
    ).toBe('refused: reason')
  }
  for (const data of [undefined, null, 3, [], { errors: [null], reason: 3 }]) {
    expect(missionErrorText(new AxiomRpcError('refused', 'refused', data))).toBe('refused: refused')
  }
  expect(
    missionErrorText(
      new AxiomRpcError('refused', 'Explicit message', {
        errors: [{ message: 'unused' }],
        reason: 'unused'
      })
    )
  ).toBe('refused: Explicit message')
  expect(missionErrorText(new Error('ordinary'))).toBe('Error: ordinary')
  expect(missionErrorText('plain')).toBe('plain')
})
