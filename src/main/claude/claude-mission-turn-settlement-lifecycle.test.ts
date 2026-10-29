import { afterEach, expect, it, vi } from 'vitest'
import { registerClaudeMissionSessionPins } from './claude-mission-session-pins'
import {
  acquired,
  claudeFrame,
  fakeClaude,
  USER_MESSAGE
} from './claude-structured-session-test-support'

const disposals: (() => void | Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of disposals.splice(0).toReversed()) {
    await dispose()
  }
})

async function fixture() {
  const onTurnSettled = vi.fn()
  disposals.push(
    registerClaudeMissionSessionPins('dispatch', 'session-1', {
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
  const claude = fakeClaude({ replayUuid: null })
  const adapter = await acquired(claude)
  const connection = claude.connections[0]
  if (!connection) {
    throw new Error('Missing acquired Claude connection')
  }
  disposals.push(() => adapter.releaseAcquisition({ sessionId: 'session-1' }))
  const frame = (message: Record<string, unknown>) => claudeFrame(connection, message)
  const idle = (parent?: string) =>
    frame({
      type: 'system',
      subtype: 'session_state_changed',
      state: 'idle',
      ...(parent ? { parent_tool_use_id: parent } : {})
    })
  const send = async (id: string, started = true) => {
    await expect(
      adapter.dispatch({
        sessionId: 'session-1',
        fence: 7,
        clientMessageId: id,
        body: USER_MESSAGE
      })
    ).resolves.toMatchObject({ state: 'admitted' })
    const uuid = connection.sent.at(-1)?.uuid
    if (typeof uuid !== 'string') {
      throw new Error('Missing dispatched send uuid')
    }
    frame({ type: 'command_lifecycle', command_uuid: uuid, state: 'queued' })
    if (started) {
      frame({ type: 'command_lifecycle', command_uuid: uuid, state: 'started' })
    }
    return uuid
  }
  return { onTurnSettled, adapter, frame, idle, send }
}

it.each([true, false])(
  'settles a correlated result with no echo or output (started frame: %s)',
  async (started) => {
    const { onTurnSettled, frame, idle, send } = await fixture()
    const uuid = await send('result-only', started)
    const result = {
      type: 'result',
      uuid: 'result-only-end',
      user_message_uuid: uuid,
      is_error: true,
      terminal_reason: 'api_error',
      num_turns: 0
    }
    frame(result)
    idle()
    frame(result)
    expect(onTurnSettled).toHaveBeenCalledExactlyOnceWith({
      outcome: 'failure',
      isError: true,
      numTurns: 0
    })
  }
)

it('settles a started send at idle without echo/output, ignoring startup and queued idle', async () => {
  const { onTurnSettled, adapter, frame, idle, send } = await fixture()
  idle()
  const uuid = await send('idle-only', false)
  idle()
  expect(onTurnSettled).not.toHaveBeenCalled()
  frame({ type: 'command_lifecycle', command_uuid: uuid, state: 'started' })
  idle()
  idle()
  expect(adapter.holdsDispatch('session-1')).toBe(false)
  expect(onTurnSettled).toHaveBeenCalledExactlyOnceWith({
    outcome: 'unknown',
    isError: false,
    numTurns: null
  })
})

it('ignores child ends and settles each successive started root turn exactly once', async () => {
  const { onTurnSettled, frame, idle, send } = await fixture()
  await send('first')
  frame({ type: 'result', parent_tool_use_id: 'child', is_error: false })
  idle('child')
  expect(onTurnSettled).not.toHaveBeenCalled()
  idle()
  expect(onTurnSettled).toHaveBeenCalledTimes(1)
  const uuid = await send('second')
  frame({
    type: 'result',
    uuid: 'second-end',
    user_message_uuid: uuid,
    is_error: false,
    num_turns: 1
  })
  idle()
  expect(onTurnSettled).toHaveBeenCalledTimes(2)
  expect(onTurnSettled).toHaveBeenLastCalledWith({
    outcome: 'success',
    isError: false,
    numTurns: 1
  })
})
