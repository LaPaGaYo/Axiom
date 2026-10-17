import { expect, it } from 'vitest'
import { projectAttemptState } from './attempt-params'
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
