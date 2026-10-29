import { afterEach, expect, it, vi } from 'vitest'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'
import { registerClaudeMissionSessionPins } from './claude-mission-session-pins'
const dispose: (() => void)[] = []
afterEach(() => {
  for (const close of dispose.splice(0)) {
    close()
  }
})
function fixture(pinned = true) {
  const onTurnSettled = vi.fn()
  if (pinned) {
    dispose.push(
      registerClaudeMissionSessionPins('d', 's', {
        settingsPath: '/settings',
        accountHomePath: '/home',
        skills: [],
        effort: 'high',
        managedSettings: {},
        env: {},
        mcpServers: {},
        denyPermission: () => {},
        onTurnSettled
      })
    )
  }
  const translator = createClaudeJournalTranslator({
    sink: { appendItem: () => {}, appendTombstone: () => {}, publish: () => {} }
  })
  dispose.push(() => translator.dispose())
  const frame = (message: Record<string, unknown>, startsTurn = false) =>
    translator.handle({
      type: 'message',
      sessionId: 's',
      ...(startsTurn ? { startsTurn: true } : {}),
      message,
      observedAt: 1
    })
  const open = (uuid: string) =>
    frame(
      {
        type: 'user',
        uuid,
        session_id: 'provider',
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'text', text: 'plan' }] }
      },
      true
    )
  return { frame, open, onTurnSettled, translator }
}
it.each([
  [false, 'completed', 'success'],
  [true, 'api_error', 'failure'],
  [true, 'aborted_tools', 'cancellation']
])(
  'notifies exactly once for a root result followed by idle (%s, %s)',
  (isError, reason, outcome) => {
    const { frame, open, onTurnSettled } = fixture()
    open('one')
    frame({ type: 'result', is_error: isError, num_turns: 3, terminal_reason: reason })
    frame({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
    frame({ type: 'result', is_error: isError, num_turns: 3 })
    expect(onTurnSettled).toHaveBeenCalledExactlyOnceWith({ outcome, isError, numTurns: 3 })
  }
)
it('uses idle only for a still-open turn, ignores child ends, and supports a later turn', () => {
  const { frame, open, onTurnSettled, translator } = fixture()
  frame({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
  expect(onTurnSettled).not.toHaveBeenCalled()
  open('one')
  frame({ type: 'result', parent_tool_use_id: 'child', is_error: false })
  frame({
    type: 'system',
    subtype: 'session_state_changed',
    state: 'idle',
    parent_tool_use_id: 'child'
  })
  expect(onTurnSettled).not.toHaveBeenCalled()
  expect(translator.currentTurnId).toBe('one')
  frame({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
  expect(onTurnSettled).toHaveBeenCalledExactlyOnceWith({
    outcome: 'unknown',
    isError: false,
    numTurns: null
  })
  open('two')
  frame({ type: 'result', is_error: false, num_turns: 1 })
  expect(onTurnSettled).toHaveBeenCalledTimes(2)
})
it('preserves ordinary-session journal settlement on child idle without Mission pins', () => {
  const { frame, open, translator, onTurnSettled } = fixture(false)
  open('ordinary')
  expect(translator.currentTurnId).toBe('ordinary')
  frame({
    type: 'system',
    subtype: 'session_state_changed',
    state: 'idle',
    parent_tool_use_id: 'child'
  })
  expect(translator.currentTurnId).toBeNull()
  expect(onTurnSettled).not.toHaveBeenCalled()
})
