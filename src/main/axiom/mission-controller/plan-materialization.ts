import type { z } from 'zod'
import type { PlanProposeParams } from '../../../shared/axiom-contract/plan-params'
import {
  PlanProposalSchema,
  validatePlanProposal
} from '../../../shared/axiom-contract/plan-proposal'
import type {
  PlanRevision,
  Provenance,
  TaskEdge
} from '../../../shared/axiom-contract/mission-objects'
import {
  audit,
  MissionControllerError,
  requireMission,
  requirePlan,
  type ControllerContext
} from './controller-context'
import { moveMission } from './mission-lifecycle'

function validatedProposal(input: unknown) {
  const validation = validatePlanProposal(input)
  if (!validation.ok) {
    throw new MissionControllerError('plan_invalid', { errors: validation.errors })
  }
  return { proposal: PlanProposalSchema.parse(input), order: validation.order }
}

export function proposePlan(
  ctx: ControllerContext,
  input: z.input<typeof PlanProposeParams> & { provenance: Provenance }
) {
  const mission = requireMission(ctx, input.missionId)
  const pending = ctx.store.listPlanRevisions(mission.id).find((p) => p.status === 'PROPOSED')
  if (pending) {
    throw new MissionControllerError('plan_pending', {
      missionId: mission.id,
      planRevisionId: pending.id
    })
  }
  if (mission.status !== 'ANALYZING') {
    throw new MissionControllerError('illegal_transition', {
      missionId: mission.id,
      from: mission.status,
      to: 'PLAN_REVIEW'
    })
  }
  const { proposal } = validatedProposal({ ...input.planRevision, provenance: input.provenance })
  const goal = ctx.store.getGoalRevision(proposal.goalRevisionId)
  if (
    !goal ||
    goal.missionId !== mission.id ||
    goal.status !== 'ACTIVE' ||
    mission.activeGoalRevisionId !== goal.id
  ) {
    throw new MissionControllerError('plan_invalid', {
      missionId: mission.id,
      goalRevisionId: proposal.goalRevisionId,
      errors: [
        {
          code: 'invalid_schema',
          severity: 'error',
          message: 'Plan must reference the Mission active GoalRevision',
          path: ['goalRevisionId']
        }
      ]
    })
  }
  const plan = ctx.store.insertPlanRevision(proposal, { missionId: mission.id, status: 'PROPOSED' })
  audit(ctx, {
    missionId: mission.id,
    actor: input.provenance.actor,
    objectKind: 'plan_revision',
    objectId: plan.id,
    event: 'plan.proposed',
    before: null,
    after: plan
  })
  moveMission(ctx, mission.id, 'ANALYZING', 'PLAN_REVIEW', proposal.provenance.actor)
  return plan
}

export function approvePlan(
  ctx: ControllerContext,
  input: { planRevisionId: string; resolver: string; provenance: Provenance }
) {
  const plan = requirePlan(ctx, input.planRevisionId)
  const mission = requireMission(ctx, plan.missionId)
  if (ctx.store.listPlanRevisions(mission.id).some((p) => p.status === 'APPROVED')) {
    // ponytail: M1 supports initial approval only; M5 adds inherit/cancel/rebind replanning.
    throw new MissionControllerError('replan_not_supported', {
      missionId: mission.id,
      planRevisionId: plan.id
    })
  }
  requireProposed(plan)
  if (mission.status !== 'PLAN_REVIEW') {
    throw new MissionControllerError('illegal_transition', {
      missionId: mission.id,
      from: mission.status,
      to: 'PLANNED'
    })
  }
  const { proposal, order } = validatedProposal(plan)
  if (!ctx.store.updatePlanRevisionStatus({ id: plan.id, from: 'PROPOSED', to: 'APPROVED' })) {
    throw new MissionControllerError('stale_state', {
      planRevisionId: plan.id,
      from: 'PROPOSED',
      to: 'APPROVED'
    })
  }
  ctx.store.setActiveRevisions({ id: mission.id, activePlanRevisionId: plan.id })
  audit(ctx, {
    missionId: mission.id,
    actor: input.resolver,
    objectKind: 'plan_revision',
    objectId: plan.id,
    event: 'plan.approved',
    before: { status: 'PROPOSED', activePlanRevisionId: mission.activePlanRevisionId },
    after: { status: 'APPROVED', activePlanRevisionId: plan.id, provenance: input.provenance }
  })
  const specs = new Map(proposal.tasks.map((task) => [task.id, task]))
  const ids = new Map<string, string>()
  for (const proposalId of order) {
    const spec = specs.get(proposalId)
    if (!spec) {
      throw new MissionControllerError('plan_invalid', {
        planRevisionId: plan.id,
        taskId: proposalId
      })
    }
    const task = ctx.db.createTask({
      spec: JSON.stringify(spec),
      taskTitle: spec.title,
      runId: mission.runId,
      deps: []
    })
    const record = {
      taskId: task.id,
      missionId: mission.id,
      planRevisionId: plan.id,
      stage: 'DEFINED' as const,
      previousStage: null,
      spec,
      retryPolicy: spec.retryPolicy,
      attemptCount: 0
    }
    ctx.store.insertTaskStage(record)
    ids.set(proposalId, task.id)
    audit(ctx, {
      missionId: mission.id,
      actor: input.resolver,
      objectKind: 'task',
      objectId: task.id,
      event: 'task.created',
      before: null,
      after: record
    })
  }
  const mappedId = (id: string) => {
    const mapped = ids.get(id)
    if (!mapped) {
      throw new MissionControllerError('plan_invalid', { planRevisionId: plan.id, taskId: id })
    }
    return mapped
  }
  const edges: TaskEdge[] = proposal.edges.map((edge) => ({
    ...edge,
    fromTaskId: mappedId(edge.fromTaskId),
    toTaskId: mappedId(edge.toTaskId)
  }))
  ctx.store.insertTaskEdges(mission.id, plan.id, edges)
  audit(ctx, {
    missionId: mission.id,
    actor: input.resolver,
    objectKind: 'plan_revision',
    objectId: plan.id,
    event: 'plan.materialized',
    before: null,
    after: { taskIds: [...ids.values()], edges }
  })
  moveMission(ctx, mission.id, 'PLAN_REVIEW', 'PLANNED', input.resolver)
  return requirePlan(ctx, plan.id)
}

function requireProposed(plan: PlanRevision) {
  if (plan.status !== 'PROPOSED') {
    throw new MissionControllerError('plan_not_proposed', {
      planRevisionId: plan.id,
      status: plan.status
    })
  }
}

export function rejectPlan(
  ctx: ControllerContext,
  input: { planRevisionId: string; reason: string; resolver: string }
) {
  const plan = requirePlan(ctx, input.planRevisionId)
  requireProposed(plan)
  const mission = requireMission(ctx, plan.missionId)
  if (mission.status !== 'PLAN_REVIEW') {
    throw new MissionControllerError('illegal_transition', {
      missionId: mission.id,
      from: mission.status,
      to: 'ANALYZING'
    })
  }
  if (
    !ctx.store.updatePlanRevisionStatus({
      id: plan.id,
      from: 'PROPOSED',
      to: 'REJECTED',
      rejectedReason: input.reason
    })
  ) {
    throw new MissionControllerError('stale_state', {
      planRevisionId: plan.id,
      from: 'PROPOSED',
      to: 'REJECTED'
    })
  }
  audit(ctx, {
    missionId: mission.id,
    actor: input.resolver,
    objectKind: 'plan_revision',
    objectId: plan.id,
    event: 'plan.rejected',
    before: { status: plan.status },
    after: { status: 'REJECTED', reason: input.reason }
  })
  moveMission(ctx, mission.id, 'PLAN_REVIEW', 'ANALYZING', input.resolver, input.reason)
  return requirePlan(ctx, plan.id)
}
