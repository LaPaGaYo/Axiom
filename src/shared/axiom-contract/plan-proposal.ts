import { z } from 'zod'
import {
  AxiomIdSchema,
  MilestoneSchema,
  PlanRiskSchema,
  ProvenanceSchema,
  TaskEdgeSchema,
  TaskSpecSchema
} from './mission-objects'
import { orderPlanTasks } from './plan-task-graph'

export const PlanProposalSchema = z.object({
  goalRevisionId: AxiomIdSchema,
  milestones: z.array(MilestoneSchema),
  tasks: z.array(TaskSpecSchema),
  edges: z.array(TaskEdgeSchema),
  risks: z.array(PlanRiskSchema),
  provenance: ProvenanceSchema
})
export type PlanProposal = z.infer<typeof PlanProposalSchema>

export type PlanProposalError = {
  code:
    | 'invalid_schema'
    | 'duplicate_task_id'
    | 'unknown_edge_endpoint'
    | 'self_edge'
    | 'duplicate_edge'
    | 'cycle'
    | 'unknown_milestone'
    | 'insufficient_parallel_roots'
    | 'threshold_not_supported'
  severity: 'error' | 'warning'
  message: string
  taskIds?: string[]
  path?: (string | number)[]
}

export type PlanProposalValidation =
  | { ok: true; order: string[] }
  | { ok: false; errors: PlanProposalError[] }

export function validatePlanProposal(
  proposal: unknown,
  options: { requireParallelRoots?: number } = {}
): PlanProposalValidation {
  const parsed = PlanProposalSchema.safeParse(proposal)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        code: 'invalid_schema',
        severity: 'error',
        message: issue.message,
        path: issue.path.map((part) => (typeof part === 'number' ? part : String(part)))
      }))
    }
  }
  const { tasks, edges, milestones } = parsed.data
  const errors: PlanProposalError[] = []
  const ids = new Set<string>()
  const milestoneIds = new Set(milestones.map((milestone) => milestone.id))
  for (const task of tasks) {
    if (ids.has(task.id)) {
      errors.push({
        code: 'duplicate_task_id',
        severity: 'error',
        message: `Duplicate task: ${task.id}`,
        taskIds: [task.id]
      })
    }
    ids.add(task.id)
    if (task.milestoneId !== undefined && !milestoneIds.has(task.milestoneId)) {
      errors.push({
        code: 'unknown_milestone',
        severity: 'error',
        message: `Unknown milestone: ${task.milestoneId}`,
        taskIds: [task.id]
      })
    }
  }
  const seenEdges = new Set<string>()
  for (const edge of edges) {
    const taskIds = [edge.fromTaskId, edge.toTaskId]
    if (edge.readinessThreshold === 'VERIFIED') {
      errors.push({
        code: 'threshold_not_supported',
        severity: 'error',
        message: 'V1 supports only INTEGRATED dependencies',
        taskIds
      })
    }
    if (taskIds.some((id) => !ids.has(id))) {
      errors.push({
        code: 'unknown_edge_endpoint',
        severity: 'error',
        message: `Unknown edge endpoint: ${taskIds.filter((id) => !ids.has(id)).join(', ')}`,
        taskIds
      })
    }
    if (edge.fromTaskId === edge.toTaskId) {
      errors.push({
        code: 'self_edge',
        severity: 'error',
        message: `Self edge: ${edge.fromTaskId}`,
        taskIds: [edge.fromTaskId]
      })
    }
    // JSON tuple encoding avoids collisions when task IDs themselves contain separators.
    const key = JSON.stringify(taskIds)
    if (seenEdges.has(key)) {
      errors.push({
        code: 'duplicate_edge',
        severity: 'error',
        message: `Duplicate edge: ${edge.fromTaskId} → ${edge.toTaskId}`,
        taskIds
      })
    }
    seenEdges.add(key)
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const { order, roots, cycle } = orderPlanTasks([...ids], edges)
  if (cycle.length > 0) {
    errors.push({
      code: 'cycle',
      severity: 'error',
      message: `Dependency cycle: ${cycle.join(' → ')}`,
      taskIds: cycle
    })
  }
  if (options.requireParallelRoots !== undefined && roots.length < options.requireParallelRoots) {
    errors.push({
      code: 'insufficient_parallel_roots',
      severity: 'warning',
      message: `Expected at least ${options.requireParallelRoots} root tasks; found ${roots.length}`,
      taskIds: roots
    })
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, order }
}
