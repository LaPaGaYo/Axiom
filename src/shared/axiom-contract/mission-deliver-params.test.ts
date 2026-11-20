import { expect, it } from 'vitest'
import * as params from './mission-params'

it('deliver params are a mission id and an approval id and nothing else', () => {
  expect(params).toHaveProperty('MissionDeliverParams')
  const input = { missionId: 'mission', approvalId: 'approval' }
  expect(params.MissionDeliverParams.parse(input)).toEqual(input)
  for (const invalid of [
    {},
    { missionId: 'mission' },
    { approvalId: 'approval' },
    { ...input, missionId: '' },
    { ...input, approvalId: '' },
    { ...input, resolver: 'user' },
    { ...input, via: 'desktop' }
  ]) {
    expect(params.MissionDeliverParams.safeParse(invalid).success).toBe(false)
  }
})
