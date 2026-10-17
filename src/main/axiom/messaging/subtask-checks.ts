import path from 'node:path'
import { z } from 'zod'
import type { TaskSpec } from '../../../shared/axiom-contract/mission-objects'
import { orderPlanTasks } from '../../../shared/axiom-contract/plan-task-graph'
import type { AxiomStore } from '../db/axiom-store'
import type { OrchestrationDb } from '../../runtime/orchestration/db'

export type Check = 'scope' | 'depth' | 'duplicate' | 'dependency' | 'budget' | 'attempt'
export type SubtaskSource = { taskId: string; attemptId: string; messageId: string }
const normalize = (value: string) =>
  path.posix.normalize(value.replaceAll('\\', '/')).replace(/\/$/, '') || '/'
const pathSet = (values: string[]) => JSON.stringify([...new Set(values.map(normalize))].sort())
const Origin = z.object({ origin: z.string().optional() })

export function checkSubtask(
  ctx: { store: AxiomStore; db: OrchestrationDb },
  input: { missionId: string; task: TaskSpec; dependsOn: string[]; source?: SubtaskSource }
): { ok: true } | { ok: false; failed: Check[] } {
  const { store, db } = ctx
  const { missionId, task, source, dependsOn } = input
  const tasks = store.listTaskStages({ missionId })
  const failed: Check[] = []
  const parent = source ? store.getTaskStage(source.taskId) : undefined
  if (source) {
    const within = (child: string, root: string) =>
      child === root ||
      (root === '.'
        ? !path.posix.isAbsolute(child) && child !== '..' && !child.startsWith('../')
        : child.startsWith(root === '/' ? root : `${root}/`))
    if (
      !parent ||
      parent.missionId !== missionId ||
      !task.scope.allowedPaths.every((p) =>
        parent.spec.scope.allowedPaths.some((root) => within(normalize(p), normalize(root)))
      )
    ) {
      failed.push('scope')
    }
    if (
      store
        .listAuditEvents({ missionId })
        .some(
          (event) =>
            event.event === 'task.created' &&
            event.objectId === source.taskId &&
            Origin.safeParse(event.after).data?.origin === 'request_subtask'
        )
    ) {
      failed.push('depth')
    }
  }
  if (
    tasks.some(
      (existing) =>
        existing.spec.title.trim().toLowerCase() === task.title.trim().toLowerCase() ||
        pathSet(existing.spec.scope.allowedPaths) === pathSet(task.scope.allowedPaths)
    )
  ) {
    failed.push('duplicate')
  }
  const ids = tasks.map((row) => row.taskId)
  const edges = [
    ...store.listTaskEdges(missionId),
    ...dependsOn.map((fromTaskId) => ({
      fromTaskId,
      toTaskId: task.id,
      readinessThreshold: 'INTEGRATED' as const
    }))
  ]
  if (
    ids.includes(task.id) ||
    dependsOn.some((id) => !ids.includes(id)) ||
    edges.some(
      (edge) =>
        ![...ids, task.id].includes(edge.fromTaskId) || ![...ids, task.id].includes(edge.toTaskId)
    ) ||
    orderPlanTasks([...ids, task.id], edges).cycle.length
  ) {
    failed.push('dependency')
  }
  const policy = store.getPolicy(missionId)
  if (
    !policy ||
    (policy.budget.maxAttempts !== undefined &&
      tasks.reduce((sum, row) => sum + row.attemptCount, 0) >= policy.budget.maxAttempts)
  ) {
    failed.push('budget')
  }
  if (source) {
    const binding = store.getAttemptBindingByDispatch(source.attemptId)
    const dispatch = db.getDispatchContextById(source.attemptId)
    if (
      !binding ||
      binding.missionId !== missionId ||
      binding.taskId !== source.taskId ||
      dispatch?.status !== 'dispatched' ||
      dispatch.task_id !== source.taskId ||
      dispatch.run_id !== store.getMission(missionId)?.runId
    ) {
      failed.push('attempt')
    }
  }
  return failed.length ? { ok: false, failed } : { ok: true }
}
