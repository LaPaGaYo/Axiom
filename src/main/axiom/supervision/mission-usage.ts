import type { z } from 'zod'
import {
  AttemptTokenUsageSchema,
  MissionUsageParams,
  MissionUsageResponseSchema
} from '../../../shared/axiom-contract/token-usage'
import type { AxiomStore } from '../db/axiom-store'
import { MissionControllerError } from '../mission-controller/controller-context'

export function missionUsage(store: AxiomStore, input: z.input<typeof MissionUsageParams>) {
  const p = MissionUsageParams.parse(input)
  if (!store.getMission(p.missionId)) {
    throw new MissionControllerError('mission_not_found', { missionId: p.missionId })
  }
  const tasks = store.listTaskStages({ missionId: p.missionId })
  if (p.taskId && !tasks.some((task) => task.taskId === p.taskId)) {
    throw new MissionControllerError('task_not_found', { taskId: p.taskId })
  }
  const rows = store.listAttemptTokenUsage({ missionId: p.missionId })
  const grouped = new Map<string, typeof rows>()
  for (const row of rows) {
    const attempts = grouped.get(row.taskId) ?? []
    attempts.push(row)
    grouped.set(row.taskId, attempts)
  }
  const usage = tasks.map((task) => {
    const attempts = grouped.get(task.taskId) ?? []
    return {
      taskId: task.taskId,
      limit: task.spec.budget?.maxTokens ?? null,
      used: attempts.reduce((sum, row) => sum + row.newTokens, 0),
      attempts: attempts.map((row) => AttemptTokenUsageSchema.parse(row))
    }
  })
  return MissionUsageResponseSchema.parse({
    missionId: p.missionId,
    limit: store.getPolicy(p.missionId)?.budget.maxTokens ?? null,
    used: usage.reduce((sum, task) => sum + task.used, 0),
    tasks: p.taskId ? usage.filter((task) => task.taskId === p.taskId) : usage
  })
}
