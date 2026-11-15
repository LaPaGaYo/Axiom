import { resolveAcceptance } from '../../../../shared/axiom-contract/acceptance'
import type {
  AcceptanceCriterion,
  PlanRevision,
  TaskSpec
} from '../../../../shared/axiom-contract/mission-objects'

export function visiblePlanRevisions(plans: PlanRevision[], activeId: string | null) {
  const visible = plans.filter((plan) => plan.status === 'PROPOSED' || plan.id === activeId)
  if (visible.length || activeId) {
    return visible
  }
  const latest = plans.reduce<PlanRevision | undefined>(
    (found, plan) => (!found || plan.revision > found.revision ? plan : found),
    undefined
  )
  return latest?.status === 'REJECTED' ? [latest] : []
}

export function previousRejectedPlan(plan: PlanRevision, revisions: PlanRevision[]) {
  return revisions
    .filter(
      (revision) =>
        revision.missionId === plan.missionId &&
        revision.status === 'REJECTED' &&
        revision.revision < plan.revision
    )
    .reduce<PlanRevision | undefined>(
      (found, revision) => (!found || revision.revision > found.revision ? revision : found),
      undefined
    )
}

function subtract<T>(entries: T[], other: T[], identity: (entry: T) => string) {
  const counts = new Map<string, number>()
  for (const entry of other) {
    const key = identity(entry)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return entries.filter((entry) => {
    const key = identity(entry)
    const count = counts.get(key) ?? 0
    if (!count) {
      return true
    }
    counts.set(key, count - 1)
    return false
  })
}
function entriesDiff<T>(before: T[], after: T[], identity: (entry: T) => string) {
  return { removed: subtract(before, after, identity), added: subtract(after, before, identity) }
}
function hasEntries(diff: { removed: unknown[]; added: unknown[] }) {
  return diff.removed.length > 0 || diff.added.length > 0
}
function criterionIdentity({ text, check }: AcceptanceCriterion) {
  return JSON.stringify([
    text,
    check.kind,
    check.kind === 'command'
      ? check.command
      : check.kind === 'artifact'
        ? (check.artifactKind ?? null)
        : null
  ])
}
function budgetEntries(task: TaskSpec) {
  return Object.entries(task.budget ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
}

type ScalarField = 'title' | 'objective' | 'role' | 'risk' | 'attemptLimit' | 'milestone' | 'kind'
type ListField = 'paths' | 'acceptance' | 'coverage' | 'budget'
type ChangeEntry = string | AcceptanceCriterion
export type TaskChanges = {
  task: TaskSpec
  scalars: {
    field: ScalarField
    before: string | number | undefined
    after: string | number | undefined
  }[]
  lists: { field: ListField; removed: ChangeEntry[]; added: ChangeEntry[] }[]
}
function taskChanges(before: TaskSpec, after: TaskSpec): TaskChanges {
  const scalars: TaskChanges['scalars'] = [
    { field: 'title', before: before.title, after: after.title },
    { field: 'objective', before: before.objective, after: after.objective },
    { field: 'role', before: before.role, after: after.role },
    { field: 'risk', before: before.risk, after: after.risk },
    {
      field: 'attemptLimit',
      before: before.retryPolicy.maxAttempts,
      after: after.retryPolicy.maxAttempts
    },
    { field: 'milestone', before: before.milestoneId, after: after.milestoneId },
    { field: 'kind', before: before.kind, after: after.kind }
  ]
  const lists: TaskChanges['lists'] = [
    { field: 'paths', ...entriesDiff(before.scope.allowedPaths, after.scope.allowedPaths, String) },
    {
      field: 'acceptance',
      ...entriesDiff(resolveAcceptance(before), resolveAcceptance(after), criterionIdentity)
    },
    {
      field: 'coverage',
      ...entriesDiff(
        (before.coversGoalCriteria ?? []).map((index) => `#${index}`),
        (after.coversGoalCriteria ?? []).map((index) => `#${index}`),
        String
      )
    },
    { field: 'budget', ...entriesDiff(budgetEntries(before), budgetEntries(after), String) }
  ]
  return {
    task: after,
    scalars: scalars.filter((part) => part.before !== part.after),
    lists: lists.filter(hasEntries)
  }
}
export function planRevisionDiff(before: PlanRevision, after: PlanRevision) {
  const oldTasks = new Map(before.tasks.map((task) => [task.id, task]))
  const tasks = entriesDiff(before.tasks, after.tasks, (task) => task.id)
  const changed = after.tasks.flatMap((task) => {
    const old = oldTasks.get(task.id)
    if (!old) {
      return []
    }
    const change = taskChanges(old, task)
    return change.scalars.length || change.lists.length ? [change] : []
  })
  const edges = entriesDiff(before.edges, after.edges, (edge) =>
    JSON.stringify([edge.fromTaskId, edge.toTaskId, edge.readinessThreshold])
  )
  const milestones = hasEntries(
    entriesDiff(before.milestones, after.milestones, (milestone) =>
      JSON.stringify([milestone.id, milestone.title, [...milestone.exitCriteria].sort()])
    )
  )
  const risks = hasEntries(
    entriesDiff(before.risks, after.risks, (risk) =>
      JSON.stringify([risk.id, risk.description, risk.mitigation ?? null])
    )
  )
  return {
    tasks,
    changed,
    edges,
    milestones,
    risks,
    any: hasEntries(tasks) || changed.length > 0 || hasEntries(edges) || milestones || risks
  }
}
