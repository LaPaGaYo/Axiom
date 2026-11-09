import type { TaskEdge, TaskSpec } from './mission-objects'
import { matchesPathPattern, normalizePathPattern } from './path-patterns'
import type { PlanWarning } from './plan-warnings'

function entriesOverlap(a: string, b: string): boolean {
  const left = normalizePathPattern(a)
  const right = normalizePathPattern(b)
  if (left === null || right === null) {
    return false
  }
  if (left === '.' || right === '.') {
    return true
  }
  const leftGlob = /[*?]/.test(left)
  const rightGlob = /[*?]/.test(right)
  if (leftGlob && rightGlob) {
    return a === b
  }
  if (leftGlob) {
    return matchesPathPattern(right, left)
  }
  if (rightGlob) {
    return matchesPathPattern(left, right)
  }
  return matchesPathPattern(left, right) || matchesPathPattern(right, left)
}

export function scopeOverlaps({
  tasks,
  edges
}: {
  tasks: TaskSpec[]
  edges: TaskEdge[]
}): PlanWarning[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const ids = [...byId.keys()].sort()
  const children = new Map(ids.map((id) => [id, new Set<string>()]))
  for (const edge of edges) {
    children.get(edge.fromTaskId)?.add(edge.toTaskId)
  }
  const reachable = new Map<string, Set<string>>()
  for (const id of ids) {
    const visited = new Set<string>()
    const pending = [...(children.get(id) ?? [])]
    for (let i = 0; i < pending.length; i++) {
      const next = pending[i]
      if (visited.has(next)) {
        continue
      }
      visited.add(next)
      pending.push(...(children.get(next) ?? []))
    }
    reachable.set(id, visited)
  }
  const warnings: PlanWarning[] = []
  // ponytail: V1 plans have 8–15 Tasks; index scopes if quadratic pair scans become material.
  for (const [i, a] of ids.entries()) {
    for (const b of ids.slice(i + 1)) {
      if (reachable.get(a)?.has(b) || reachable.get(b)?.has(a)) {
        continue
      }
      const paths: { a: string; b: string }[] = []
      for (const left of [...new Set(byId.get(a)?.scope.allowedPaths)].sort()) {
        for (const right of [...new Set(byId.get(b)?.scope.allowedPaths)].sort()) {
          if (entriesOverlap(left, right)) {
            paths.push({ a: left, b: right })
          }
        }
      }
      if (paths.length) {
        warnings.push({
          code: 'scope_overlap',
          message: `Parallel Tasks ${a} and ${b} have overlapping allowedPaths.`,
          taskIds: [a, b],
          paths
        })
      }
    }
  }
  return warnings
}
