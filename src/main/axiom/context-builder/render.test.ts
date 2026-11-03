import { expect, it } from 'vitest'
import { workerProtocol } from './render'

it('renders the headless report contract and compaction recovery point without CLI instructions', () => {
  const text = workerProtocol('mission-1', 'task-1', 'headless')
  expect(text).toContain('.axiom/prompt.md')
  expect(text).toContain('re-read')
  expect(text).toContain('.axiom/artifacts/')
  expect(text).toContain('```json')
  expect(text).toContain('checksRun')
  expect(text).toContain('no network and an empty package store')
  expect(text).toContain('do not try to install dependencies')
  expect(text).toContain('result: "skipped"')
  expect(text).not.toContain('axiom attempt')
})
it('keeps the terminal protocol as the default fallback', () => {
  expect(workerProtocol('mission-1', 'task-1')).toContain(
    'axiom attempt submit --attempt {{attemptId}} --report <path.json>'
  )
})

it.each(['tui', 'headless'] as const)(
  'requires self-checks and the own toolchain on %s',
  (channel) => {
    const protocol = workerProtocol('mission', 'task', channel)
    expect(protocol).toContain('Required verification commands')
    expect(protocol).toContain('re-read the complete diff against acceptanceCriteria')
    expect(protocol).toContain('AGENTS.md, CLAUDE.md and REVIEW.md where present')
    expect(protocol).toContain('checksRun never decides the verdict')
    expect(protocol).toContain(
      'never symlink, copy or borrow node_modules, .bin or caches from any other directory'
    )
    expect(protocol).toContain('dependencies are missing, say so in limitations')
    expect(protocol).toContain('candidate_already_correct')
    expect(protocol).toContain('cannot_reproduce')
    expect(protocol).toContain('blocked_by_scope')
    if (channel === 'headless') {
      expect(protocol).toContain('do not submit an unchanged tree as submitted')
    } else {
      expect(protocol).toContain('axiom attempt blocked --attempt {{attemptId}} --reason')
    }
  }
)
