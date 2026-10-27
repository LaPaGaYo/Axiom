import { z } from 'zod'
import { HeadlessSubmissionReportSchema } from '../../../shared/axiom-contract/submission-params'
import { parseClaudeWorkerEvents } from './claude-worker-events'

const Usage = z.object({
  input_tokens: z.number().nonnegative().optional(),
  cached_input_tokens: z.number().nonnegative().optional(),
  output_tokens: z.number().nonnegative().optional(),
  cache_write_input_tokens: z.number().nonnegative().optional(),
  reasoning_output_tokens: z.number().nonnegative().optional()
})
const Event = z.object({
  type: z.enum([
    'thread.started',
    'turn.started',
    'item.started',
    'item.updated',
    'item.completed',
    'turn.completed',
    'turn.failed',
    'error'
  ]),
  thread_id: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
  usage: Usage.optional()
})
type HeadlessWorkerEvents = Omit<ReturnType<typeof parseClaudeWorkerEvents>, 'usage'> & {
  usage?: z.infer<typeof Usage>
}
export function parseHeadlessWorkerEvents(text: string, provider = 'codex'): HeadlessWorkerEvents {
  if (provider === 'claude') {
    return parseClaudeWorkerEvents(text)
  }
  let providerSessionId: string | undefined
  let usage: z.infer<typeof Usage> | undefined
  let lastError: string | undefined
  let turnError: string | undefined
  let hasEvents = false
  for (const line of text.split(/\r?\n/)) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    const parsed = Event.safeParse(value)
    if (!parsed.success) {
      continue
    }
    const event = parsed.data
    hasEvents = true
    if (event.type === 'thread.started') {
      providerSessionId = event.thread_id
    }
    if (event.type === 'turn.completed') {
      usage = event.usage
    }
    if (event.type === 'turn.failed') {
      turnError = event.error?.message
    }
    if (event.type === 'error') {
      lastError = event.message
    }
  }
  const failureMessage = turnError ?? lastError
  return {
    hasEvents,
    turnFailed: turnError !== undefined,
    lastError: failureMessage,
    ...(failureMessage !== undefined
      ? {
          lastErrorEvent: {
            type: turnError !== undefined ? 'turn.failed' : 'error',
            message: failureMessage
          }
        }
      : {}),
    ...(providerSessionId ? { providerSessionId } : {}),
    ...(usage ? { usage } : {})
  }
}

export function headlessFailureKind(events: ReturnType<typeof parseHeadlessWorkerEvents>) {
  return !events.hasEvents ||
    /auth(?:entication|orization)?|unauthori[sz]ed|login|log(?:ged)? in|invalid.token|quota|rate.?limit|usage limit|insufficient.credit|429|401/i.test(
      events.lastError ?? ''
    )
    ? ('interrupted' as const)
    : ('failed' as const)
}

export function parseHeadlessReport(message: string) {
  const match = /(?:^|\n)```json\s*\n([^]*?)\n```\s*$/.exec(message)
  if (!match) {
    throw new Error('Invalid report: final fenced JSON block is missing.')
  }
  try {
    return HeadlessSubmissionReportSchema.parse(JSON.parse(match[1]))
  } catch {
    throw new Error('Invalid report: JSON does not match HeadlessSubmissionReportSchema.')
  }
}
