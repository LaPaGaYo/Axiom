import { GoalBodySchema, type GoalBody } from '../../../shared/axiom-contract/mission-objects'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import {
  audit,
  MissionControllerError,
  requireMission,
  type ControllerContext
} from './controller-context'
import { moveMission } from './mission-lifecycle'

export function getGoal(
  ctx: ControllerContext,
  input: { missionId: string; goalRevisionId: string }
) {
  requireMission(ctx, input.missionId)
  const goal = ctx.store.getGoalRevision(input.goalRevisionId)
  if (!goal || goal.missionId !== input.missionId) {
    throw new MissionControllerError('goal_revision_not_found', input)
  }
  return goal
}

export function proposeGoal(ctx: ControllerContext, input: { missionId: string; goal: GoalBody }) {
  const mission = requireMission(ctx, input.missionId)
  if (TERMINAL_MISSION_STATUSES.has(mission.status)) {
    throw new MissionControllerError('illegal_transition', {
      missionId: mission.id,
      from: mission.status,
      command: 'goal.propose'
    })
  }
  const body = GoalBodySchema.parse(input.goal)
  const goal = ctx.store.insertGoalRevision(body, { missionId: mission.id, status: 'PROPOSED' })
  audit(ctx, {
    missionId: mission.id,
    actor: body.provenance.actor,
    objectKind: 'goal_revision',
    objectId: goal.id,
    event: 'goal.proposed',
    before: null,
    after: goal
  })
  return goal
}

export function activateGoal(
  ctx: ControllerContext,
  input: { missionId: string; goalRevisionId: string }
) {
  const mission = requireMission(ctx, input.missionId)
  const goal = getGoal(ctx, input)
  if (goal.status !== 'PROPOSED') {
    throw new MissionControllerError('goal_not_proposed', { ...input, status: goal.status })
  }
  // A pending/approved initial plan must not silently start against a different goal.
  // M5 owns replacement-plan approval and Task inherit/cancel/rebind after REPLANNING.
  if (mission.status !== 'ANALYZING' && mission.status !== 'EXECUTING') {
    throw new MissionControllerError('illegal_transition', {
      ...input,
      from: mission.status,
      command: 'goal.activate'
    })
  }
  const previous =
    mission.activeGoalRevisionId === null
      ? undefined
      : getGoal(ctx, {
          missionId: mission.id,
          goalRevisionId: mission.activeGoalRevisionId
        })
  if (previous) {
    if (
      !ctx.store.updateGoalRevisionStatus({ id: previous.id, from: 'ACTIVE', to: 'SUPERSEDED' })
    ) {
      throw new MissionControllerError('stale_state', { goalRevisionId: previous.id })
    }
    audit(ctx, {
      missionId: mission.id,
      actor: 'user',
      objectKind: 'goal_revision',
      objectId: previous.id,
      event: 'goal.superseded',
      before: previous,
      after: { ...previous, status: 'SUPERSEDED' }
    })
  }
  if (!ctx.store.updateGoalRevisionStatus({ id: goal.id, from: 'PROPOSED', to: 'ACTIVE' })) {
    throw new MissionControllerError('stale_state', input)
  }
  ctx.store.setActiveRevisions({ id: mission.id, activeGoalRevisionId: goal.id })
  ctx.store.updateRunObjective(mission.runId, goal.objective)
  if (mission.status === 'EXECUTING') {
    moveMission(ctx, mission.id, 'EXECUTING', 'REPLANNING', 'user', 'Goal changed: MAJOR_REPLAN')
  }
  const activated = getGoal(ctx, input)
  audit(ctx, {
    missionId: mission.id,
    actor: 'user',
    objectKind: 'goal_revision',
    objectId: goal.id,
    event: 'goal.activated',
    before: goal,
    after: { ...activated, replanLevel: 'MAJOR_REPLAN', supersedesId: previous?.id ?? null }
  })
  return activated
}
