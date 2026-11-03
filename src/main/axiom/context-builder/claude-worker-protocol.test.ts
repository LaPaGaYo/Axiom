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
  expect(protocol).toContain(
    'Before finishing, run the commands under "Required verification commands"'
  )
  expect(protocol).toContain('AGENTS.md, CLAUDE.md and REVIEW.md where present')
  expect(protocol).toContain('result: "skipped" and a note; checksRun never decides the verdict')
  expect(protocol).toContain("Use only this worktree's own toolchain")
  expect(protocol).toContain('never symlink, copy or borrow node_modules, .bin or caches')
  expect(protocol).toContain('"outcome":"submitted"')
  expect(protocol).toContain('"outcome":"no_change","reason":"candidate_already_correct"')
  expect(protocol).toContain('use reason "cannot_reproduce"')
  expect(protocol).toContain('"outcome":"blocked","reason":"blocked_by_scope"')
  expect(workerProtocol('mission', 'task', 'headless', 'codex')).toBe(
    workerProtocol('mission', 'task', 'headless')
  )
})
