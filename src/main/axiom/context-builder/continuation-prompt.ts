import type { InPlaceContinuation } from '../execution/in-place-continuation'
import { endingLine } from './previous-preserved-attempt'
import { tokenBudgetLines, type TokenBudgets } from './token-budget'

export function continuationPrompt(input: {
  missionId: string
  taskId: string
  branch: string
  continuation: InPlaceContinuation
  tokenBudgets?: TokenBudgets
}) {
  const c = input.continuation
  return [
    `Mission: ${input.missionId}`,
    `Task: ${input.taskId}`,
    'Attempt: {{attemptId}}',
    '',
    'This message continues the same conversation for the same Task as a new Attempt with the id above. The original unfinished task continues; this message does not replace it.',
    endingLine({ previousSeq: c.fromSeq, ending: c.ending }),
    `This is the same worktree: ${c.worktree.path}.`,
    c.preserved
      ? `The host preserved what the previous Attempt left as commit ${c.targetCommit} on top of ${c.parentCommit} and moved the worktree to branch ${input.branch} at that commit without changing a file. Run git diff ${c.parentCommit} HEAD to see the earlier changes.`
      : `The previous Attempt left no changes. The worktree was moved to branch ${input.branch} at ${c.targetCommit} without changing a file.`,
    'An action that was cut off may have taken effect or may still be running. Check before repeating anything with side effects, and say when it cannot be confirmed.',
    'Look at the working tree and the git history before changing anything.',
    'The Task contract is unchanged. Its complete current copy with this Attempt\u2019s id is .axiom/prompt.md. Read it when anything is unclear or after a compaction. That file wins where it disagrees with memory.',
    ...tokenBudgetLines(input.tokenBudgets),
    'End this Attempt as the protocol says, with exactly one fenced json report block.'
  ].join('\n')
}
