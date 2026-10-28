import { z } from 'zod'

export const ClaudeInitSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  claude_code_version: z.string().optional(),
  model: z.string(),
  permissionMode: z.string(),
  tools: z.array(z.string()).default([]),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string().optional() })).default([]),
  skills: z.array(z.string()).default([]),
  // `path: 'builtin'` classifies the harness's own plugins; `source` keeps the provenance string as reported.
  plugins: z
    .array(z.object({ name: z.string(), path: z.string().optional(), source: z.string().optional() }))
    .default([]),
  apiKeySource: z.string().optional(),
  session_id: z.string().optional()
})
export type ClaudeInit = z.infer<typeof ClaudeInitSchema>
const ResultSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  result: z.string().optional(),
  session_id: z.string().optional(),
  usage: z
    .object({
      input_tokens: z.number().nonnegative().optional(),
      cache_read_input_tokens: z.number().nonnegative().optional(),
      cache_creation_input_tokens: z.number().nonnegative().optional(),
      output_tokens: z.number().nonnegative().optional()
    })
    .optional(),
  modelUsage: z
    .record(
      z.string(),
      z.object({
        inputTokens: z.number().nonnegative().optional(),
        outputTokens: z.number().nonnegative().optional(),
        cacheReadInputTokens: z.number().nonnegative().optional(),
        cacheCreationInputTokens: z.number().nonnegative().optional(),
        costUSD: z.number().nonnegative().optional()
      })
    )
    .optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  // Tool inputs can contain secrets. Retain denial identity, never the input payload.
  permission_denials: z
    .array(
      z.object({
        tool_name: z.string(),
        tool_use_id: z.string().optional()
      })
    )
    .optional()
})

export function parseClaudeWorkerEvents(text: string) {
  let claudeInit: ClaudeInit | undefined
  let result: z.infer<typeof ResultSchema> | undefined
  let malformedResult = false
  for (const line of text.split(/\r?\n/)) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    const init = ClaudeInitSchema.safeParse(value)
    if (init.success && !claudeInit) {
      claudeInit = init.data
    }
    const final = ResultSchema.safeParse(value)
    if (z.object({ type: z.literal('result') }).safeParse(value).success) {
      result = final.success ? final.data : undefined
      malformedResult = !final.success
    }
  }
  const turnFailed = Boolean(
    malformedResult || result?.is_error || result?.subtype.startsWith('error_')
  )
  const lastError = malformedResult
    ? 'Malformed Claude result event'
    : turnFailed
      ? result?.errors?.join('\n') || result?.result || result?.subtype
      : undefined
  const providerSessionId = result?.session_id ?? claudeInit?.session_id
  return {
    hasEvents: Boolean(claudeInit || result || malformedResult),
    turnFailed,
    lastError,
    ...(lastError
      ? { lastErrorEvent: { type: result?.subtype ?? 'error_invalid_result', message: lastError } }
      : {}),
    ...(providerSessionId ? { providerSessionId } : {}),
    ...(claudeInit ? { claudeInit } : {}),
    ...(result?.result !== undefined ? { lastMessage: result.result } : {}),
    ...(result?.usage
      ? {
          usage: {
            ...(result.usage.input_tokens !== undefined
              ? { input_tokens: result.usage.input_tokens }
              : {}),
            ...(result.usage.cache_read_input_tokens !== undefined
              ? { cached_input_tokens: result.usage.cache_read_input_tokens }
              : {}),
            ...(result.usage.cache_creation_input_tokens !== undefined
              ? { cache_write_input_tokens: result.usage.cache_creation_input_tokens }
              : {}),
            ...(result.usage.output_tokens !== undefined
              ? { output_tokens: result.usage.output_tokens }
              : {})
          }
        }
      : {}),
    ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
    ...(result?.total_cost_usd !== undefined ? { total_cost_usd: result.total_cost_usd } : {}),
    ...(result?.num_turns !== undefined ? { num_turns: result.num_turns } : {}),
    ...(result?.permission_denials ? { permission_denials: result.permission_denials } : {})
  }
}
