import type { TaskEdge } from './mission-objects'

// Iterative DFS reports an actual cycle, excluding tasks merely downstream of it.
function findCycle(ids: string[], successors: Map<string, string[]>): string[] {
  const visited = new Set<string>()
  const active = new Map<string, number>()
  for (const id of ids) {
    if (visited.has(id)) {
      continue
    }
    const stack = [{ id, next: 0 }]
    active.set(id, 0)
    visited.add(id)
    while (stack.length > 0) {
      const frame = stack.at(-1)!
      const next = successors.get(frame.id)?.[frame.next++]
      if (next === undefined) {
        active.delete(frame.id)
        stack.pop()
      } else if (active.has(next)) {
        return stack.slice(active.get(next)).map((entry) => entry.id)
      } else if (!visited.has(next)) {
        visited.add(next)
        active.set(next, stack.length)
        stack.push({ id: next, next: 0 })
      }
    }
  }
  return []
}

/** Only called after task identities and edge endpoints have been validated. */
export function orderPlanTasks(taskIds: string[], edges: TaskEdge[]) {
  const ids = [...taskIds].sort()
  const successors = new Map(ids.map((id): [string, string[]] => [id, []]))
  const incoming = new Map(ids.map((id) => [id, 0]))
  for (const edge of edges) {
    successors.get(edge.fromTaskId)?.push(edge.toTaskId)
    incoming.set(edge.toTaskId, (incoming.get(edge.toTaskId) ?? 0) + 1)
  }
  for (const children of successors.values()) {
    children.sort()
  }
  const roots = ids.filter((id) => incoming.get(id) === 0)
  const ready = [...roots]
  const order: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    order.push(id)
    for (const next of successors.get(id) ?? []) {
      const remaining = (incoming.get(next) ?? 0) - 1
      incoming.set(next, remaining)
      if (remaining === 0) {
        ready.push(next)
      }
    }
    // ponytail: sorted frontier is sufficient for V1's 8–15 tasks; use a min-heap
    // if large plans make the O(V² log V) worst-case frontier work significant.
    ready.sort()
  }
  return { order, roots, cycle: order.length === ids.length ? [] : findCycle(ids, successors) }
}
