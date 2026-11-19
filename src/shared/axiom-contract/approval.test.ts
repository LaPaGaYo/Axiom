import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import {
  APPROVAL_STATUSES,
  APPROVAL_TRANSITIONS,
  APPROVAL_ACTION_KINDS,
  ApprovalSchema,
  isLegalApprovalTransition
} from './approval'
import { MissionResponseSchema } from './mission-params'

const approval = {
  id: 'approval',
  missionId: 'mission',
  actionKind: 'delivery',
  inputsHash: createHash('sha256').update('completion report').digest('hex'),
  risk: 'high',
  status: 'PENDING',
  expiresAt: '2099-01-01',
  requestedBy: 'fixture',
  resolver: null,
  resolution: null,
  createdAt: '2026-11-19 12:00:00',
  updatedAt: '2026-11-19 12:00:00'
}

it('the approval transitions allow only the listed moves and four statuses have no way out', () => {
  const moves: Record<string, string[]> = {
    PENDING: ['GRANTED', 'DENIED', 'EXPIRED', 'REVOKED'],
    GRANTED: ['CONSUMED', 'REVOKED', 'EXPIRED'],
    DENIED: [],
    EXPIRED: [],
    REVOKED: [],
    CONSUMED: []
  }
  expect([...APPROVAL_STATUSES].sort()).toEqual(Object.keys(moves).sort())
  expect(APPROVAL_TRANSITIONS).toEqual(moves)
  expect(Object.values(moves).filter((targets) => targets.length === 0)).toHaveLength(4)
  for (const from of APPROVAL_STATUSES) {
    for (const to of APPROVAL_STATUSES) {
      expect(isLegalApprovalTransition(from, to), `${from} → ${to}`).toBe(moves[from].includes(to))
    }
  }
  expect(APPROVAL_ACTION_KINDS).toEqual(['delivery', 'budget_increase'])
})

it('an approval with an unknown key or an unknown status does not parse', () => {
  expect(ApprovalSchema.parse(approval)).toEqual(approval)
  for (const invalid of [
    { ...approval, extra: true },
    { ...approval, status: 'OTHER' },
    { ...approval, actionKind: 'OTHER' },
    { ...approval, inputsHash: '' }
  ]) {
    expect(ApprovalSchema.safeParse(invalid).success).toBe(false)
  }
})

it('a mission response parses with an approval and without one', () => {
  const response = {
    mission: {
      id: 'mission',
      runId: 'run',
      repoId: 'repo',
      repoPath: '/repository',
      targetBranch: 'main',
      status: 'READY_FOR_APPROVAL',
      activeGoalRevisionId: 'goal',
      activePlanRevisionId: 'plan'
    }
  }
  expect(MissionResponseSchema.parse(response)).toEqual(response)
  expect(MissionResponseSchema.parse({ ...response, approval })).toEqual({ ...response, approval })
})
