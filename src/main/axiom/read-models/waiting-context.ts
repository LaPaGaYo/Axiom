import type { AxiomStore } from '../db/axiom-store'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AuditEvent, TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import { MissionControllerError } from '../mission-controller/controller-context'
import { budgetExhaustion, missionAttemptCount } from '../scheduler/admission-budget'
import type { BudgetExhaustion } from '../scheduler/admission-budget'

export function utcTimestamp(value: string): string {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toISOString()
}

export function auditReason(event: AuditEvent | undefined): string | undefined {
  const after = event?.after
  return after && typeof after === 'object' && 'reason' in after && typeof after.reason === 'string'
    ? after.reason
    : undefined
}

export function createWaitingContext(
  store: AxiomStore,
  db: OrchestrationDb,
  missionId: string,
  clock: () => string
) {
  const mission = store.getMission(missionId)
  if (!mission) {
    throw new MissionControllerError('mission_not_found', { missionId })
  }
  const policy = store.getPolicy(missionId)
  if (!policy) {
    throw new Error('mission_policy_missing')
  }
  const now = clock()
  const tasks = store.listTaskStages({ missionId })
  const tasksById = new Map(tasks.map((task) => [task.taskId, task]))
  const plans = store.listPlanRevisions(missionId)
  const plansById = new Map(plans.map((plan) => [plan.id, plan]))
  const edges = store.listReadModelTaskEdges(missionId)
  const upstream = new Map<string, string[]>()
  const downstream = new Map<string, string[]>()
  for (const edge of edges) {
    const target = tasksById.get(edge.toTaskId)
    if (target?.planRevisionId !== edge.planRevisionId) {
      continue
    }
    const sources = upstream.get(edge.toTaskId) ?? []
    sources.push(edge.fromTaskId)
    upstream.set(edge.toTaskId, sources)
    if (tasksById.get(edge.fromTaskId)?.planRevisionId !== edge.planRevisionId) {
      continue
    }
    const targets = downstream.get(edge.fromTaskId) ?? []
    targets.push(edge.toTaskId)
    downstream.set(edge.fromTaskId, targets)
  }
  const bindings = store.listAttemptBindings({ missionId })
  const latestBindings = new Map(bindings.map((binding) => [binding.taskId, binding]))
  const candidates = store
    .listCandidates(missionId)
    .filter((candidate) => candidate.status === 'ACTIVE')
  const candidatesByTask = new Map<string, (typeof candidates)[number]>()
  for (const candidate of candidates) {
    if (!candidatesByTask.has(candidate.taskId)) {
      candidatesByTask.set(candidate.taskId, candidate)
    }
  }
  const runs = store.listVerificationRuns({ missionId })
  const latestRuns = new Map(runs.map((run) => [run.candidateId, run]))
  const stageAudits = new Map<string, AuditEvent | undefined>()
  function stageAudit(task: TaskStageRecord) {
    if (!stageAudits.has(task.taskId)) {
      stageAudits.set(
        task.taskId,
        store.getLatestReadModelAudit({
          missionId,
          objectKind: 'task',
          objectId: task.taskId,
          events: ['task.stage'],
          ...(task.stage === 'BLOCKED' ? { stage: 'BLOCKED' } : {})
        })
      )
    }
    return stageAudits.get(task.taskId)
  }
  function verification(taskId: string) {
    const candidate = candidatesByTask.get(taskId)
    return { candidate, latest: candidate ? latestRuns.get(candidate.id) : undefined }
  }
  let missionBudget: BudgetExhaustion | undefined
  if (mission.status === 'EXECUTING') {
    missionBudget = budgetExhaustion(store, missionId, policy, () => now)
  } else if (mission.status === 'ANALYZING') {
    const attempts = missionAttemptCount(store, missionId)
    if (policy.budget.maxAttempts !== undefined && attempts >= policy.budget.maxAttempts) {
      missionBudget = { dimension: 'maxAttempts', limit: policy.budget.maxAttempts, used: attempts }
    } else if (policy.budget.maxTokens !== undefined) {
      const used = store.sumAttemptTokenUsage({ missionId })
      if (used >= policy.budget.maxTokens) {
        missionBudget = { dimension: 'maxTokens', limit: policy.budget.maxTokens, used }
      }
    }
  }
  return {
    store,
    db,
    now,
    mission,
    policy,
    tasks,
    tasksById,
    plans,
    plansById,
    upstream,
    downstream,
    bindings,
    latestBindings,
    verification,
    stageAudit,
    missionBudget,
    runningCount: tasks.filter((task) => task.stage === 'RUNNING').length,
    blockingApproval: store.hasBlockingApproval(missionId)
  }
}

export type WaitingContext = ReturnType<typeof createWaitingContext>
