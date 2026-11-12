import { expect, it } from 'vitest'
import { continuationPrompt } from './continuation-prompt'

const input = {
  missionId: 'm',
  taskId: 't',
  branch: 'axiom/attempt/t/2',
  continuation: {
    strategy: 'resumed_in_place' as const,
    id: 'thread',
    fromSeq: 1,
    originSeq: 1,
    worktree: { id: 'repo::/absolute/worktree', path: '/absolute/worktree' },
    preserved: true,
    targetCommit: 'snapshot',
    parentCommit: 'parent',
    treeSha: 'tree',
    ending: { kind: 'interrupted' as const, failureClass: 'usage_limit' as const }
  }
}
it('states the entire continuation contract without repeating the Task spec', () => {
  const text = continuationPrompt(input)
  expect(text.startsWith('Mission: m\nTask: t\nAttempt: {{attemptId}}\n')).toBe(true)
  for (const clause of [
    'same conversation',
    'same Task',
    'new Attempt',
    'original unfinished task',
    'does not replace',
    'Attempt 1 was interrupted by usage_limit.',
    '/absolute/worktree',
    'commit snapshot on top of parent',
    'branch axiom/attempt/t/2',
    'without changing a file',
    'git diff parent HEAD',
    'may have taken effect or may still be running',
    'Check before repeating anything with side effects',
    'say when it cannot be confirmed',
    'Look at the working tree and the git history',
    'Task contract is unchanged',
    '.axiom/prompt.md',
    'after a compaction',
    'disagrees with memory',
    'exactly one fenced json report block'
  ]) {
    expect(text).toContain(clause)
  }
  expect(text).not.toMatch(/## Task spec|Repository rules|reset --hard|checkout --|git clean/)
})
it('describes the empty and host-observed restart cases using the shared ending', () => {
  const text = continuationPrompt({
    ...input,
    continuation: {
      ...input.continuation,
      preserved: false,
      ending: { kind: 'interrupted', failureClass: 'unknown', evidence: 'runtime_restarted' }
    }
  })
  expect(text).toContain(
    'The runtime that started Attempt 1 restarted, and the Attempt process was gone afterwards.'
  )
  expect(text).toContain('left no changes')
  expect(text).toContain('branch axiom/attempt/t/2 at snapshot')
})
