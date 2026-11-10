import { expect, it } from 'vitest'
import { readHeadlessHandoffRecords } from './headless-handoff-records'

const stream = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join('\n')
it('takes messages and commands from the event stream of either harness', () => {
  const codex = readHeadlessHandoffRecords(
    stream([
      {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm1', text: 'Reviewing the parser' }
      },
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          id: 'c1',
          command: 'pnpm test parser',
          exit_code: null,
          aggregated_output: ''
        }
      },
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          id: 'c1',
          command: 'pnpm test parser',
          exit_code: 1,
          aggregated_output: 'parser failed'
        }
      },
      { type: 'item.completed', item: { type: 'file_change', changes: ['ignored'] } }
    ]),
    'codex'
  )
  expect(codex).toEqual({
    messages: ['Reviewing the parser'],
    commands: [
      { command: 'pnpm test parser', output: 'parser failed', unfinished: false, exitCode: 1 }
    ]
  })
  const claude = readHeadlessHandoffRecords(
    stream([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Checking the previous result' },
            { type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'first' } },
            { type: 'tool_use', id: 'ignored', name: 'Read', input: { command: 'not a shell' } },
            { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'second' } }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'b',
              content: [{ type: 'text', text: 'second output' }],
              is_error: true
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'a', content: 'first output', is_error: false }
          ]
        }
      }
    ]),
    'claude'
  )
  expect(claude).toEqual({
    messages: ['Checking the previous result'],
    commands: [
      { command: 'first', output: 'first output', unfinished: false, isError: false },
      { command: 'second', output: 'second output', unfinished: false, isError: true }
    ]
  })
})

it('marks a command without completion as unfinished when the stream ends', () => {
  expect(
    readHeadlessHandoffRecords(
      stream([
        {
          type: 'item.started',
          item: {
            type: 'command_execution',
            id: 'c',
            command: 'apply migration',
            exit_code: null,
            aggregated_output: 'began'
          }
        }
      ]),
      'codex'
    ).commands
  ).toEqual([{ command: 'apply migration', output: 'began', unfinished: true }])
  expect(
    readHeadlessHandoffRecords(
      stream([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'apply migration' } }
            ]
          }
        }
      ]),
      'claude'
    ).commands[0]?.unfinished
  ).toBe(true)
})

it('keeps only bounded redacted recent records and skips malformed lines and other tools', () => {
  const secret = `ghp_${'x'.repeat(28)}`
  const rows = Array.from({ length: 30 }, (_, i) => [
    {
      type: 'item.completed',
      item: { type: 'agent_message', id: `m${i}`, text: `${'a'.repeat(1100)} tail-${i} ${secret}` }
    },
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        id: `c${i}`,
        command: `${secret} ${'c'.repeat(400)}`,
        exit_code: 0,
        aggregated_output: `${'o'.repeat(400)} tail-${i} ${secret}`
      }
    }
  ]).flat()
  const result = readHeadlessHandoffRecords(
    `garbage\nnull\n{\n${stream(rows)}\n{"type":"item.completed","item":null}`,
    'codex'
  )
  expect(result.messages).toHaveLength(5)
  expect(result.commands).toHaveLength(20)
  expect(result.messages[0]).toContain('tail-25 [REDACTED]')
  expect(result.commands.at(-1)?.output).toContain('tail-29 [REDACTED]')
  expect(result.messages.every((message) => message.length <= 1000)).toBe(true)
  expect(
    result.commands.every(({ command, output }) => command.length <= 300 && output.length <= 300)
  ).toBe(true)
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(readHeadlessHandoffRecords(stream(rows), 'unknown')).toEqual({
    messages: [],
    commands: []
  })
})

it('does not resurrect an older command when its completion arrives after 20 newer commands', () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    type: 'item.started',
    item: { type: 'command_execution', id: `c${i}`, command: `command-${i}` }
  }))
  const result = readHeadlessHandoffRecords(
    stream([
      ...rows,
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          id: 'c0',
          command: 'command-0',
          exit_code: 0,
          aggregated_output: 'late'
        }
      }
    ]),
    'codex'
  )
  expect(result.commands.map(({ command }) => command)).toEqual(
    Array.from({ length: 20 }, (_, i) => `command-${i + 1}`)
  )
})
