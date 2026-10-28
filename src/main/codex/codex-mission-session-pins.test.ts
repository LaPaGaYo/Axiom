import { expect, it } from 'vitest'
import {
  codexMissionSessionPins,
  registerCodexMissionSessionPins
} from './codex-mission-session-pins'

it('copies and freezes caller-owned env, fences both identities and releases idempotently', () => {
  const pins = { env: { HTTPS_PROXY: 'http://127.0.0.1:9' } }
  const release = registerCodexMissionSessionPins('dispatch', 'session', pins)
  try {
    pins.env.HTTPS_PROXY = 'changed'
    const registered = codexMissionSessionPins('session')
    expect(registered?.env.HTTPS_PROXY).toBe('http://127.0.0.1:9')
    expect(Object.isFrozen(registered)).toBe(true)
    expect(Object.isFrozen(registered?.env)).toBe(true)
    expect(codexMissionSessionPins('ordinary-chat')).toBeUndefined()
    expect(() => registerCodexMissionSessionPins('dispatch', 'other-session', pins)).toThrow(
      'Codex Planner launch policy already registered'
    )
    expect(() => registerCodexMissionSessionPins('other-dispatch', 'session', pins)).toThrow(
      'Codex Planner launch policy already registered'
    )
  } finally {
    release()
  }
  expect(codexMissionSessionPins('session')).toBeUndefined()
  const replacement = registerCodexMissionSessionPins('dispatch', 'session', pins)
  try {
    release()
    expect(codexMissionSessionPins('session')?.env.HTTPS_PROXY).toBe('changed')
  } finally {
    replacement()
  }
})
