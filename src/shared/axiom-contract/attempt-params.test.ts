import { expect, it } from 'vitest'
import { AttemptSummarySchema, projectAttemptState } from './attempt-params'
import { attempt } from './contract-fixtures.test-support'
it.each([
  ['starting', 'STARTING'],
  ['ready', 'RUNNING'],
  ['stopping', 'RUNNING'],
  ['succeeded', 'SUBMITTED'],
  ['failed', 'FAILED'],
  ['stopped', 'STOPPED'],
  ['abandoned', 'ABANDONED'],
  ['start_unknown', 'START_UNKNOWN'],
  ['stop_unknown', 'STOP_UNKNOWN']
])('maps %s to %s', (worker, state) => {
  expect(projectAttemptState({ worker, dispatch: 'active' })).toBe(state)
  expect(projectAttemptState({ worker, dispatch: 'circuit_broken' })).toBe('FAILED')
})

it('validates optional submission hashes and requires a declared execution role', () => {
  expect(AttemptSummarySchema.parse(attempt)).toEqual(attempt)
  expect(AttemptSummarySchema.safeParse({ ...attempt, role: 'coordinator' }).success).toBe(false)
  expect(
    AttemptSummarySchema.safeParse({
      ...attempt,
      submission: { ...attempt.submission, commitSha: 'short-sha' }
    }).success
  ).toBe(false)
  expect(
    AttemptSummarySchema.parse({ ...attempt, submission: undefined }).submission
  ).toBeUndefined()
})

it('accepts old submission payloads and preserves the optional transcript Artifact reference', () => {
  expect(AttemptSummarySchema.parse(attempt).submission).not.toHaveProperty('transcriptArtifactId')
  const payload = {
    ...attempt,
    submission: { ...attempt.submission, transcriptArtifactId: 'art-transcript' }
  }
  expect(AttemptSummarySchema.parse(payload).submission?.transcriptArtifactId).toBe(
    'art-transcript'
  )
})
