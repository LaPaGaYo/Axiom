import { describe, expect, it } from 'vitest'
import {
  MissionCancelParams,
  MissionCreateParams,
  MissionListParams,
  MissionPauseParams,
  MissionResumeParams,
  MissionShowParams,
  MissionSummarySchema
} from './mission-params'
import { goal, mission, policy } from './contract-fixtures.test-support'

describe('axiom.mission params', () => {
  it.each([
    [
      'create',
      MissionCreateParams,
      { repo: '/repo', targetBranch: 'main', goal, policy },
      { repo: '', targetBranch: 'main', goal, policy }
    ],
    ['show', MissionShowParams, { missionId: 'm' }, { missionId: '' }],
    [
      'list',
      MissionListParams,
      { repo: '/repo', status: 'EXECUTING', cursor: 'm' },
      { status: 'done' }
    ],
    ['pause', MissionPauseParams, { missionId: 'm', reason: 'Wait' }, { missionId: 'm' }],
    [
      'resume',
      MissionResumeParams,
      { missionId: 'm', reason: 'Ready' },
      { missionId: 'm', reason: '' }
    ],
    [
      'cancel',
      MissionCancelParams,
      { missionId: 'm', reason: 'Canceled by user' },
      { reason: 'Cancel' }
    ]
  ])('%s accepts valid and rejects invalid params', (_, schema, valid, invalid) => {
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse(invalid).success).toBe(false)
  })
  it('lists without filters and exposes a minimal Mission summary', () => {
    expect(MissionListParams.safeParse({}).success).toBe(true)
    expect(MissionSummarySchema.safeParse(mission).success).toBe(true)
    expect(MissionSummarySchema.safeParse({ ...mission, status: 'completed' }).success).toBe(false)
  })
})
