import { expect, it } from 'vitest'
import { headlessFailureKind, parseHeadlessWorkerEvents } from './headless-worker-events'

const jsonl = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n')
it('reads Claude init and final result, preserving usage, cost and safe permission denials', () => {
  const text = jsonl(
    {
      type: 'system',
      subtype: 'init',
      claude_code_version: '2.1.309',
      model: 'claude-opus-5',
      permissionMode: 'acceptEdits',
      tools: ['Read', 'Bash'],
      mcp_servers: [{ name: 'allowed', status: 'connected' }],
      skills: ['review'],
      plugins: [],
      apiKeySource: 'none',
      session_id: 'session-1'
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'intermediate' }] } },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'final report',
      session_id: 'session-1',
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 3,
        output_tokens: 8
      },
      total_cost_usd: 0.42,
      num_turns: 4,
      modelUsage: { 'claude-opus-5': { inputTokens: 12, outputTokens: 8, costUSD: 0.42 } },
      permission_denials: [
        { tool_name: 'WebFetch', tool_use_id: 'tool-1', tool_input: { url: 'private-input' } }
      ]
    }
  )
  const result = parseHeadlessWorkerEvents(`noise\n${text}\n{`, 'claude')
  expect(result).toMatchObject({
    hasEvents: true,
    providerSessionId: 'session-1',
    turnFailed: false,
    lastMessage: 'final report',
    usage: {
      input_tokens: 12,
      cached_input_tokens: 40,
      cache_write_input_tokens: 3,
      output_tokens: 8
    },
    total_cost_usd: 0.42,
    num_turns: 4,
    modelUsage: { 'claude-opus-5': { inputTokens: 12, outputTokens: 8, costUSD: 0.42 } },
    permission_denials: [{ tool_name: 'WebFetch', tool_use_id: 'tool-1' }],
    claudeInit: {
      claude_code_version: '2.1.309',
      model: 'claude-opus-5',
      permissionMode: 'acceptEdits',
      skills: ['review']
    }
  })
  expect(JSON.stringify(result)).not.toContain('private-input')
})
it.each([
  ['error_during_execution', ['Not logged in'], 'interrupted'],
  ['error_during_execution', ['401 Unauthorized'], 'interrupted'],
  ['error_during_execution', ['invalid token'], 'interrupted'],
  ['error_max_turns', [], 'failed'],
  ['error_max_budget_usd', ['Budget exceeded'], 'failed'],
  ['error_max_structured_output_retries', [], 'failed']
])('classifies Claude %s (%s)', (subtype, errors, kind) => {
  const events = parseHeadlessWorkerEvents(
    jsonl({ type: 'result', subtype, is_error: true, errors }),
    'claude'
  )
  expect(events.turnFailed).toBe(true)
  expect(headlessFailureKind(events)).toBe(kind)
})
it('does not substitute intermediate assistant output for a missing result', () => {
  const events = parseHeadlessWorkerEvents(
    jsonl({ type: 'assistant', message: { content: [{ text: 'not final' }] } }),
    'claude'
  )
  expect(events.lastMessage).toBeUndefined()
})
it('invalidates an earlier result when a later result has a malformed payload', () => {
  const events = parseHeadlessWorkerEvents(
    jsonl(
      { type: 'result', subtype: 'success', result: 'earlier report' },
      { type: 'result', subtype: 'success', result: 42 }
    ),
    'claude'
  )
  expect(events.lastMessage).toBeUndefined()
  expect(events.turnFailed).toBe(true)
})
