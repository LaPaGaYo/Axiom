import { z } from 'zod'
import { redactContext } from '../context-builder/redaction'
import { PreservedChangeSchema } from './preserved-snapshot-contract'
import {
  HANDOFF_MESSAGE_LIMIT,
  HANDOFF_MESSAGE_CHAR_LIMIT,
  HANDOFF_COMMAND_LIMIT,
  HANDOFF_COMMAND_CHAR_LIMIT,
  HANDOFF_OUTPUT_CHAR_LIMIT,
  PRESERVED_PATH_LIMIT
} from './preservation-policy'

const CommandSchema = z.object({
  command: z.string().max(HANDOFF_COMMAND_CHAR_LIMIT),
  output: z.string().max(HANDOFF_OUTPUT_CHAR_LIMIT),
  unfinished: z.boolean(),
  exitCode: z.number().int().optional(),
  isError: z.boolean().optional()
})
export const HandoffRecordsSchema = z.object({
  version: z.literal(1),
  taskId: z.string(),
  attemptId: z.string(),
  messages: z.array(z.string().max(HANDOFF_MESSAGE_CHAR_LIMIT)).max(HANDOFF_MESSAGE_LIMIT),
  commands: z.array(CommandSchema).max(HANDOFF_COMMAND_LIMIT),
  changes: z.array(PreservedChangeSchema).max(PRESERVED_PATH_LIMIT)
})
type Command = z.infer<typeof CommandSchema>
const Event = z.object({
  type: z.string(),
  item: z.unknown().optional(),
  message: z.unknown().optional()
})
const CodexItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('agent_message'), text: z.string() }),
  z.object({
    type: z.literal('command_execution'),
    id: z.string(),
    command: z.string(),
    aggregated_output: z.string().optional(),
    exit_code: z.number().int().nullable().optional()
  })
])
const ClaudeMessage = z.object({ content: z.array(z.unknown()) })
const ClaudeItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.literal('Bash'),
    input: z.object({ command: z.string() })
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    is_error: z.boolean().optional(),
    content: z
      .union([z.string(), z.array(z.object({ type: z.literal('text'), text: z.string() }))])
      .optional()
  })
])

/** Only this Attempt stream is inspected; event text never acquires instruction authority. */
export function readHeadlessHandoffRecords(eventsText: string, provider: string) {
  const messages: string[] = []
  const commands = new Map<string, Command>()
  const seenCommands = new Set<string>()
  const tail = (text: string, limit: number) => redactContext(text).content.slice(-limit)
  const addMessage = (text: string) => {
    messages.push(tail(text, HANDOFF_MESSAGE_CHAR_LIMIT))
    if (messages.length > HANDOFF_MESSAGE_LIMIT) {
      messages.shift()
    }
  }
  const addCommand = (id: string, value: Command) => {
    commands.set(id, value)
    if (commands.size > HANDOFF_COMMAND_LIMIT) {
      const oldest = commands.keys().next().value
      if (oldest !== undefined) {
        commands.delete(oldest)
      }
    }
  }
  try {
    for (const line of eventsText.split('\n')) {
      try {
        const event = Event.parse(JSON.parse(line))
        if (provider === 'codex' && ['item.started', 'item.completed'].includes(event.type)) {
          const parsed = CodexItem.safeParse(event.item)
          if (!parsed.success) {
            continue
          }
          const item = parsed.data
          if (item.type === 'agent_message') {
            if (event.type === 'item.completed') {
              addMessage(item.text)
            }
          } else {
            if (seenCommands.has(item.id) && !commands.has(item.id)) {
              continue
            }
            seenCommands.add(item.id)
            addCommand(item.id, {
              command: redactContext(item.command).content.slice(0, HANDOFF_COMMAND_CHAR_LIMIT),
              output: tail(item.aggregated_output ?? '', HANDOFF_OUTPUT_CHAR_LIMIT),
              unfinished: event.type !== 'item.completed',
              ...(typeof item.exit_code === 'number' ? { exitCode: item.exit_code } : {})
            })
          }
        } else if (provider === 'claude' && ['assistant', 'user'].includes(event.type)) {
          const message = ClaudeMessage.safeParse(event.message)
          if (!message.success) {
            continue
          }
          for (const block of message.data.content) {
            const parsed = ClaudeItem.safeParse(block)
            if (!parsed.success) {
              continue
            }
            const item = parsed.data
            if (event.type === 'assistant' && item.type === 'text') {
              addMessage(item.text)
            }
            if (event.type === 'assistant' && item.type === 'tool_use') {
              addCommand(item.id, {
                command: redactContext(item.input.command).content.slice(
                  0,
                  HANDOFF_COMMAND_CHAR_LIMIT
                ),
                output: '',
                unfinished: true
              })
            }
            if (event.type === 'user' && item.type === 'tool_result') {
              const command = commands.get(item.tool_use_id)
              if (!command) {
                continue
              }
              addCommand(item.tool_use_id, {
                ...command,
                unfinished: false,
                isError: item.is_error ?? false,
                output: tail(
                  typeof item.content === 'string'
                    ? item.content
                    : (item.content ?? []).map(({ text }) => text).join('\n'),
                  HANDOFF_OUTPUT_CHAR_LIMIT
                )
              })
            }
          }
        }
      } catch {
        // Incomplete JSON or a changed harness shape supplies no records for this line.
      }
    }
  } catch {
    // Malformed input cannot prevent settlement.
  }
  return { messages, commands: [...commands.values()] }
}
