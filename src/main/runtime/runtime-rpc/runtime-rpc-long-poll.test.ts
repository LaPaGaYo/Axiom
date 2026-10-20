import { describe, expect, it } from 'vitest'
import { classifyRuntimeLongPoll } from './runtime-rpc-long-poll'

describe('classifyRuntimeLongPoll', () => {
  it.each(['axiom.mission.plan', 'orchestration.workerStart'])(
    'keeps %s alive while waiting for agent readiness',
    (method) => {
      expect(classifyRuntimeLongPoll({ id: 'request', authToken: 'token', method })).toBe('wait')
    }
  )

  it.each(['axiom.mission.show', 'axiom.plan.propose'])(
    'leaves %s outside the long-poll budget',
    (method) => {
      expect(classifyRuntimeLongPoll({ id: 'request', authToken: 'token', method })).toBeNull()
    }
  )

  it('keeps orchestration.check alive when wait is true', () => {
    expect(
      classifyRuntimeLongPoll({
        id: 'request',
        authToken: 'token',
        method: 'orchestration.check',
        params: { wait: true }
      })
    ).toBe('wait')
  })

  it.each([undefined, {}, { wait: false }])(
    'leaves orchestration.check outside the long-poll budget with params %j',
    (params) => {
      expect(
        classifyRuntimeLongPoll({
          id: 'request',
          authToken: 'token',
          method: 'orchestration.check',
          params
        })
      ).toBeNull()
    }
  )
})
