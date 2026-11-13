/** Opt-in per-message stream fixture; result.usage remains the existing aggregate. */
export const AXIOM_CLAUDE_USAGE_SOURCE = `
function emitFixtureClaudeUsage(emit, taskId) {
  if (!existsSync(process.env.AXIOM_E2E_LEDGER + '.usage-' + taskId)) return
  const assistant = (id, input, writes, cached, output) => ({ type: 'assistant',
    parent_tool_use_id: id === 'B' ? 'fixture-subagent' : null,
    message: { id, role: 'assistant', content: [], usage: { input_tokens: input,
      cache_creation_input_tokens: writes, cache_read_input_tokens: cached, output_tokens: output } } })
  emit(assistant('A', 10, 300, 1000, 5))
  emit(assistant('A', 10, 300, 1000, 40))
  emit(assistant('B', 20, 0, 1300, 60))
}
`
