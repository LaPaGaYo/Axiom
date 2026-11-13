import type { AxiomStore } from '../db/axiom-store'

export type TokenBudgets = {
  task?: { limit: number; used: number }
  mission?: { limit: number; used: number }
}

export function readTokenBudgets(
  store: AxiomStore,
  missionId: string,
  taskId: string
): TokenBudgets {
  const taskLimit = store.getTaskStage(taskId)?.spec.budget?.maxTokens
  const missionLimit = store.getPolicy(missionId)?.budget.maxTokens
  return {
    ...(taskLimit === undefined
      ? {}
      : { task: { limit: taskLimit, used: store.sumAttemptTokenUsage({ taskId }) } }),
    ...(missionLimit === undefined
      ? {}
      : { mission: { limit: missionLimit, used: store.sumAttemptTokenUsage({ missionId }) } })
  }
}

export function tokenBudgetLines(budgets: TokenBudgets = {}): string[] {
  const lines: string[] = []
  const amount = (n: number) => n.toLocaleString('en-US')
  function summary(owner: string, { limit, used }: { limit: number; used: number }) {
    return `${owner} token budget: ${amount(limit)} cap; ${amount(used)} used; ${amount(Math.max(0, limit - used))} remaining.`
  }
  if (budgets.task) {
    lines.push(
      summary('Task', budgets.task),
      'The count is new tokens (input not served from cache, cache writes and output) across all Attempts of this Task.',
      'At the Task cap, the host stops the Attempt, preserves its work and blocks the Task until a person raises the budget.'
    )
  }
  if (budgets.mission) {
    lines.push(
      summary('Mission', budgets.mission),
      'The Mission count is new tokens across all its Tasks and their Attempts. At the Mission cap, no new Attempt starts.'
    )
  }
  return lines
}
