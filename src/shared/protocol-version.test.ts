import { expect, it } from 'vitest'
import { RUNTIME_CAPABILITIES } from './protocol-version'

it('advertises the Axiom M1 Control Plane', () => {
  expect(RUNTIME_CAPABILITIES).toContain('axiom.control-plane.v1')
})
