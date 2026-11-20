import { expect, it } from 'vitest'
import { AXIOM_APPROVAL_METHODS } from '../../runtime/rpc/methods/axiom/approval'
import { AXIOM_METHOD_CALLER_CLASS } from '../authority/caller-authority'
import { isAxiomMutation } from '../../../shared/axiom-contract/mutations'

it('the two approval methods are desktop only durable mutations', () => {
  expect(AXIOM_APPROVAL_METHODS.map((method) => method.name)).toEqual([
    'axiom.approval.grant',
    'axiom.approval.deny'
  ])
  for (const method of AXIOM_APPROVAL_METHODS) {
    expect(method.permission).toBe('workspace')
    expect(AXIOM_METHOD_CALLER_CLASS[method.name]).toBe('desktop_only')
    expect(isAxiomMutation(method.name)).toBe(true)
  }
})
