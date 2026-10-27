import { expect, it } from 'vitest'
import { workerProtocol } from './render'

it('asks isolated Claude to read both root instruction files without requiring a CLI', () => {
  const protocol = workerProtocol('mission', 'task', 'headless', 'claude')
  expect(protocol).toContain(
    'Read AGENTS.md and CLAUDE.md at the worktree root before changing anything'
  )
  expect(protocol).toContain('not auto-loaded in isolation mode')
  expect(protocol).toContain('does not need the axiom CLI')
  expect(protocol).toContain('host snapshots and submits')
  expect(workerProtocol('mission', 'task', 'headless', 'codex')).toBe(
    workerProtocol('mission', 'task', 'headless')
  )
})
