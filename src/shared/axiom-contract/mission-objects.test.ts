import { describe, expect, it } from 'vitest'
import {
  AuditEventSchema,
  BudgetSchema,
  RoutingPolicySchema,
  GoalRevisionSchema,
  MissionSchema,
  PlanRevisionSchema,
  PolicySchema,
  ProvenanceSchema,
  TaskEdgeSchema,
  TaskStageRecordSchema,
  TaskSpecSchema
} from './mission-objects'
import { goal, makeProposal, mission, policy, provenance } from './contract-fixtures.test-support'

describe('Mission objects', () => {
  it('validates TaskStageRecord including previous stage and retry state', () => {
    const record = {
      taskId: 'T01',
      missionId: 'm',
      planRevisionId: 'p',
      stage: 'BLOCKED',
      previousStage: 'RUNNING',
      spec: makeProposal().tasks[0],
      retryPolicy: { maxAttempts: 2 },
      attemptCount: 1,
      updatedAt: '2026-10-17 12:00:00'
    }
    expect(TaskStageRecordSchema.parse(record)).toEqual(record)
    for (const invalid of [
      { stage: 'completed' },
      { previousStage: 'ready' },
      { attemptCount: -1 },
      { retryPolicy: { maxAttempts: 0 } }
    ]) {
      expect(TaskStageRecordSchema.safeParse({ ...record, ...invalid }).success).toBe(false)
    }
  })
  it('validates AuditEvent identity and JSON snapshots', () => {
    const event = {
      sequence: 1,
      missionId: 'm',
      actor: 'controller',
      objectKind: 'mission',
      objectId: 'm',
      event: 'created',
      before: null,
      after: { status: 'DRAFT' },
      createdAt: '2026-10-17 12:00:00'
    }
    expect(AuditEventSchema.parse(event)).toEqual(event)
    for (const invalid of [{ sequence: 0 }, { actor: '' }, { after: { callback: () => true } }]) {
      expect(AuditEventSchema.safeParse({ ...event, ...invalid }).success).toBe(false)
    }
  })
  it('parses persisted shapes and nullable inactive revisions', () => {
    expect(MissionSchema.safeParse(mission).success).toBe(true)
    expect(
      GoalRevisionSchema.safeParse({
        ...goal,
        id: 'g',
        missionId: 'm',
        revision: 1,
        status: 'ACTIVE'
      }).success
    ).toBe(true)
    const proposal = makeProposal()
    expect(
      PlanRevisionSchema.parse({
        id: 'p',
        missionId: 'm',
        revision: 1,
        status: 'PROPOSED',
        goalRevisionId: 'g',
        milestones: proposal.milestones,
        risks: proposal.risks,
        tasks: proposal.tasks,
        edges: proposal.edges,
        provenance
      })
    ).toMatchObject({ provenance, tasks: proposal.tasks, edges: proposal.edges })
    expect(TaskSpecSchema.safeParse(proposal.tasks[0]).success).toBe(true)
  })
  it('rejects PlanRevision with missing or invalid provenance', () => {
    const revision = {
      id: 'p',
      missionId: 'm',
      revision: 1,
      status: 'PROPOSED',
      goalRevisionId: 'g',
      milestones: [],
      risks: [],
      tasks: [],
      edges: []
    }
    expect(PlanRevisionSchema.safeParse({ ...revision, provenance }).success).toBe(true)
    expect(PlanRevisionSchema.safeParse(revision).success).toBe(false)
    for (const invalid of [
      null,
      { ...provenance, kind: 'reviewer' },
      { ...provenance, actor: '' },
      { ...provenance, at: 'yesterday' }
    ]) {
      expect(PlanRevisionSchema.safeParse({ ...revision, provenance: invalid }).success).toBe(false)
    }
  })
  it.each([0, 2, -1, 1.5, '1', null])('rejects nestedWorkerMaxDepth=%s', (nestedWorkerMaxDepth) => {
    expect(PolicySchema.safeParse({ ...policy, nestedWorkerMaxDepth }).success).toBe(false)
  })
  it('defaults readiness thresholds and liveness tolerance', () => {
    expect(PolicySchema.parse(policy).unverifiableToleranceMinutes).toBe(30)
    expect(TaskEdgeSchema.parse({ fromTaskId: 'a', toTaskId: 'b' }).readinessThreshold).toBe(
      'INTEGRATED'
    )
    const { readinessThreshold: _, ...withoutThreshold } = policy
    expect(PolicySchema.parse(withoutThreshold).readinessThreshold).toBe('INTEGRATED')
  })
  it('rejects invalid ids, revisions, retry budgets and ISO dates', () => {
    for (const id of ['', 'x'.repeat(129), 42]) {
      expect(MissionSchema.safeParse({ ...mission, id }).success).toBe(false)
    }
    for (const revision of [0, -1, 1.5]) {
      expect(
        GoalRevisionSchema.safeParse({
          ...goal,
          id: 'g',
          missionId: 'm',
          revision,
          status: 'ACTIVE'
        }).success
      ).toBe(false)
    }
    for (const maxAttempts of [0, -1, 1.5]) {
      expect(
        TaskSpecSchema.safeParse({ ...makeProposal().tasks[0], retryPolicy: { maxAttempts } })
          .success
      ).toBe(false)
    }
    expect(ProvenanceSchema.safeParse({ ...provenance, at: 'yesterday' }).success).toBe(false)
    expect(ProvenanceSchema.safeParse({ ...provenance, at: '2026-02-30T00:00:00Z' }).success).toBe(
      false
    )
    expect(
      ProvenanceSchema.safeParse({ ...provenance, at: '2026-10-17T06:00:00-06:00' }).success
    ).toBe(true)
  })
  it('validates policy numeric limits and preserves JSON policy rule payloads', () => {
    expect(PolicySchema.safeParse({ ...policy, concurrencyLimit: 0 }).success).toBe(false)
    expect(PolicySchema.safeParse({ ...policy, unverifiableToleranceMinutes: -1 }).success).toBe(
      false
    )
    expect(PolicySchema.safeParse({ ...policy, budget: { maxTokens: -1 } }).success).toBe(false)
    const rules = { approvalRules: { high: true }, verificationRules: { commands: ['pnpm test'] } }
    expect(PolicySchema.parse({ ...policy, ...rules })).toMatchObject(rules)
    expect(
      PolicySchema.safeParse({ ...policy, verificationRules: { callback: () => true } }).success
    ).toBe(false)
  })
  it('keeps Task attempt limits solely in retryPolicy and permits a Mission-wide cap', () => {
    expect(PolicySchema.safeParse({ ...policy, budget: { maxAttempts: 12 } }).success).toBe(true)
    expect(
      TaskSpecSchema.safeParse({
        ...makeProposal().tasks[0],
        budget: { maxAttempts: 1 }
      }).success
    ).toBe(false)
  })
})

it('validates wall-clock and provider concurrency limits with backward-compatible defaults', () => {
  expect(BudgetSchema.parse({ maxWallClockMinutes: 0.5 })).toEqual({ maxWallClockMinutes: 0.5 })
  expect(RoutingPolicySchema.parse({}).providerConcurrency).toEqual({})
  expect(
    RoutingPolicySchema.parse({ providerConcurrency: { claude: 2 } }).providerConcurrency
  ).toEqual({ claude: 2 })
  for (const value of [0, -1, Infinity]) {
    expect(BudgetSchema.safeParse({ maxWallClockMinutes: value }).success).toBe(false)
    expect(RoutingPolicySchema.safeParse({ providerConcurrency: { claude: value } }).success).toBe(
      false
    )
  }
  expect(RoutingPolicySchema.safeParse({ providerConcurrency: { claude: 1.5 } }).success).toBe(
    false
  )
})
