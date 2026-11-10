import { expect, it } from 'vitest'
import { AttemptBlockedParams } from './attempt-params'
import { AxiomMessagePayloadSchema, BlockedMessageSchema } from './message-params'

it('stores a host environment block but rejects it as Worker input', () => {
  const blocked = { reason: 'environment', paths: [] }
  expect(BlockedMessageSchema.parse(blocked)).toEqual(blocked)
  expect(
    AxiomMessagePayloadSchema.safeParse({
      axiom: {
        version: 1,
        type: 'BLOCKED',
        missionId: 'mission',
        taskId: 'task',
        attemptId: 'attempt',
        summary: 'Attempt 3 interrupted by usage_limit (3 consecutive interruptions)',
        artifactIds: [],
        related: { taskIds: ['task'] },
        blocked
      }
    }).success
  ).toBe(true)
  expect(
    AttemptBlockedParams.safeParse({
      attemptId: 'attempt',
      from: 'worker',
      summary: 'environment',
      blocked
    }).success
  ).toBe(false)
  for (const reason of ['blocked_by_scope', 'candidate_already_correct', 'cannot_reproduce']) {
    expect(
      AttemptBlockedParams.safeParse({
        attemptId: 'attempt',
        from: 'worker',
        summary: reason,
        blocked: { reason, paths: [] }
      }).success
    ).toBe(true)
  }
})
