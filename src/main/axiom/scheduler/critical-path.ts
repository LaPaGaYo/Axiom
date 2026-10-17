import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type { AxiomStore } from '../db/axiom-store'

export function orderByCriticalPath(
  store: Pick<AxiomStore, 'listDownstreamEdges'>,
  tasks: TaskStageRecord[]
): TaskStageRecord[] {
  const lengths = new Map<string, number>()
  function length(taskId: string): number {
    const known = lengths.get(taskId)
    if (known !== undefined) {
      return known
    }
    let longest = 0
    for (const edge of store.listDownstreamEdges(taskId)) {
      longest = Math.max(longest, 1 + length(edge.toTaskId))
    }
    lengths.set(taskId, longest)
    return longest
  }
  for (const task of tasks) {
    length(task.taskId)
  }
  return [...tasks].sort(
    (a, b) =>
      length(b.taskId) - length(a.taskId) ||
      (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)
  )
}
