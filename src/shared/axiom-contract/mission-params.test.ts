import { describe, expect, it } from 'vitest'
import {
  MissionCancelParams,
  MissionCancelResponseSchema,
  MissionCreateParams,
  MissionListParams,
  MissionPauseParams,
  MissionResumeParams,
  MissionShowParams,
  MissionPlanParams,
  MissionPlanResponseSchema,
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
    ['plan', MissionPlanParams, { missionId: 'm' }, { missionId: '' }],
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
  it('accepts both bound and pre-dispatch Planner launch receipts', () => {
    for (const attemptId of ['dispatch-1', null]) {
      expect(MissionPlanResponseSchema.safeParse({ attempt: {
        attemptId, seq: 1, branch: 'axiom/planner/m/1', worktreeId: null, provider: 'codex'
      } }).success).toBe(true)
    }
  })
  it('accepts legacy cancel responses and additive Attempt reconciliation entries', () => {
    expect(MissionCancelResponseSchema.safeParse({ mission }).success).toBe(true)
    const attempts = [
      { attemptId: 'dispatch-1', taskId: 'task-1', seq: 1, liveness: 'live', action: 'stopped' }
    ]
    expect(MissionCancelResponseSchema.parse({ mission, attempts }).attempts).toEqual(attempts)
    expect(
      MissionCancelResponseSchema.safeParse({
        mission,
        attempts: [{ ...attempts[0], liveness: 'dead' }]
      }).success
    ).toBe(false)
  })
})
