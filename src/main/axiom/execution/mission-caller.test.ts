import { expect, it } from 'vitest'
import { missionCaller } from './mission-caller'
import { sessionId } from '../mission-controller/controller-fixture.test-support'

it('builds a handle-less session caller on the precreated Attempt workspace', () => {
  expect(missionCaller(sessionId, 'wt')).toEqual({
    address: `orca_session_id:${sessionId}`,
    terminalHandle: null,
    paneKey: null,
    orcaSessionId: sessionId,
    sessionId,
    workspaceId: 'wt'
  })
  expect(() => missionCaller('term_invalid', 'wt')).toThrowError(
    expect.objectContaining({ code: 'invalid_argument' })
  )
})
