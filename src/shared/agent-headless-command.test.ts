import { expect, it } from 'vitest'
import { isHeadlessOneShotAgentCommand } from './agent-headless-command'
it('recognizes codex exec without treating a TUI prompt containing the word as headless', () => {
  expect(isHeadlessOneShotAgentCommand('codex', ['codex', 'exec', '--json', '-'])).toBe(true)
  expect(isHeadlessOneShotAgentCommand('codex', ['codex', 'explain exec usage'])).toBe(false)
})
