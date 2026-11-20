import { expect, it } from 'vitest'
import { AXIOM_MISSION_METHODS } from '../../runtime/rpc/methods/axiom/mission'
import { AXIOM_METHOD_CALLER_CLASS } from '../authority/caller-authority'
import { isAxiomMutation } from '../../../shared/axiom-contract/mutations'

it('mission.deliver is a desktop only durable mutation', () => {
  expect(
    AXIOM_MISSION_METHODS.find((method) => method.name === 'axiom.mission.deliver')
  ).toMatchObject({
    name: 'axiom.mission.deliver',
    permission: 'workspace'
  })
  expect(AXIOM_METHOD_CALLER_CLASS['axiom.mission.deliver']).toBe('desktop_only')
  expect(isAxiomMutation('axiom.mission.deliver')).toBe(true)
})
