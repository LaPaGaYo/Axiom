import path from 'node:path'
import { z } from 'zod'
import { emptyTokenUsage, type TokenUsageReading } from '../../../shared/axiom-contract/token-usage'
import { headlessAttemptDirectory } from './headless-attempt-files'
import { CLAUDE_USAGE_BYTES, readTokenUsageFile } from './token-usage-file'

const count = z.number().int().nonnegative()
const Usage = z.object({
  input_tokens: count,
  cache_creation_input_tokens: count.default(0),
  cache_read_input_tokens: count.default(0),
  output_tokens: count
})
const Assistant = z.object({
  type: z.literal('assistant'),
  message: z.object({ id: z.string().min(1), usage: Usage })
})

export async function readClaudeAttemptUsage(attemptId: string): Promise<TokenUsageReading> {
  try {
    const file = await readTokenUsageFile(
      path.join(headlessAttemptDirectory(attemptId), 'events.jsonl'),
      CLAUDE_USAGE_BYTES,
      false
    )
    if (!file) {
      return emptyTokenUsage('unavailable')
    }
    const result = emptyTokenUsage(file.cut ? 'partial' : 'complete')
    const messages = new Map<string, z.infer<typeof Usage>>()
    for (const line of file.text.split(/\r?\n/)) {
      if (!line.includes('"assistant"') || !line.includes('"usage"')) {
        continue
      }
      try {
        const raw: unknown = JSON.parse(line)
        // Text in another event may mention assistant/usage without being an assistant event.
        if (!z.object({ type: z.literal('assistant') }).safeParse(raw).success) {
          continue
        }
        const { message } = Assistant.parse(raw)
        const previous = messages.get(message.id)
        messages.set(message.id, {
          input_tokens: Math.max(previous?.input_tokens ?? 0, message.usage.input_tokens),
          cache_creation_input_tokens: Math.max(
            previous?.cache_creation_input_tokens ?? 0,
            message.usage.cache_creation_input_tokens
          ),
          cache_read_input_tokens: Math.max(
            previous?.cache_read_input_tokens ?? 0,
            message.usage.cache_read_input_tokens
          ),
          output_tokens: Math.max(previous?.output_tokens ?? 0, message.usage.output_tokens)
        })
      } catch {
        result.status = 'partial'
      }
    }
    for (const usage of messages.values()) {
      result.inputTokens += usage.input_tokens
      result.cachedInputTokens += usage.cache_read_input_tokens
      result.cacheWriteTokens += usage.cache_creation_input_tokens
      result.outputTokens += usage.output_tokens
    }
    result.newTokens = result.inputTokens + result.cacheWriteTokens + result.outputTokens
    return result
  } catch {
    return emptyTokenUsage('unavailable')
  }
}
