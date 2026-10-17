import { z } from 'zod'
import { generateId } from '../../runtime/orchestration/db/generated-id'
import { isOrcaSessionId } from '../../../shared/orca-session-address'
import {
  GoalBodySchema,
  DEFAULT_MISSION_POLICY,
  MissionSchema,
  PolicySchema,
  ProvenanceSchema,
  type GoalBody,
  type Policy,
  type Provenance
} from '../../../shared/axiom-contract/mission-objects'
import {
  isLegalMissionTransition,
  MissionStatusSchema,
  type MissionStatus
} from '../../../shared/axiom-contract/lifecycle'
import {
  audit,
  MissionControllerError,
  requireMission,
  type ControllerContext
} from './controller-context'

export { DEFAULT_MISSION_POLICY } from '../../../shared/axiom-contract/mission-objects'
export type CreateMissionInput = {
  repoId: string
  repoPath: string
  targetBranch: string
  goal: GoalBody
  policy?: Partial<Policy>
  provenance: Provenance
}
const CreateSchema = MissionSchema.pick({
  repoId: true,
  repoPath: true,
  targetBranch: true
}).extend({
  goal: GoalBodySchema,
  policy: PolicySchema.partial().optional(),
  provenance: ProvenanceSchema
})

export function createMission(ctx: ControllerContext, input: CreateMissionInput) {
  const p = CreateSchema.parse(input)
  const sessionId = ctx.mintSessionId()
  if (!isOrcaSessionId(sessionId) || ctx.store.getMissionBySessionId(sessionId)) {
    throw new MissionControllerError('synthetic_session_id_invalid', { sessionId })
  }
  const policy = PolicySchema.parse({ ...DEFAULT_MISSION_POLICY, ...p.policy })
  const run = ctx.db.createRun({
    objective: p.goal.objective,
    coordinatorHandle: null,
    coordinatorPaneKey: null,
    coordinatorOrcaSessionId: sessionId
  })
  const id = generateId('mission')
  ctx.store.insertMission({
    id,
    runId: run.id,
    coordinatorOrcaSessionId: sessionId,
    repoId: p.repoId,
    repoPath: p.repoPath,
    targetBranch: p.targetBranch,
    status: 'DRAFT',
    activeGoalRevisionId: null,
    activePlanRevisionId: null
  })
  ctx.store.upsertPolicy(id, policy)
  audit(ctx, {
    missionId: id,
    actor: p.provenance.actor,
    objectKind: 'mission',
    objectId: id,
    event: 'mission.created',
    before: null,
    after: { ...requireMission(ctx, id), policy, provenance: p.provenance }
  })
  const goalRevision = ctx.store.insertGoalRevision(p.goal, { missionId: id, status: 'ACTIVE' })
  ctx.store.setActiveRevisions({ id, activeGoalRevisionId: goalRevision.id })
  audit(ctx, {
    missionId: id,
    actor: p.provenance.actor,
    objectKind: 'goal_revision',
    objectId: goalRevision.id,
    event: 'goal.activated',
    before: null,
    after: goalRevision
  })
  moveMission(ctx, id, 'DRAFT', 'ANALYZING', p.provenance.actor)
  return { mission: projectMission(ctx, id), goalRevision, policy }
}

export function projectMission(ctx: ControllerContext, id: string) {
  return { ...requireMission(ctx, id), countTaskStages: ctx.store.countTaskStages(id) }
}

export function moveMission(
  ctx: ControllerContext,
  id: string,
  from: MissionStatus,
  to: MissionStatus,
  actor = 'MissionController',
  reason: string | null = null,
  restoring = false
) {
  const before = requireMission(ctx, id)
  if (!isLegalMissionTransition(from, to)) {
    throw new MissionControllerError('illegal_transition', { missionId: id, from, to })
  }
  if (before.status !== from) {
    throw new MissionControllerError('stale_state', {
      missionId: id,
      from,
      to,
      actual: before.status
    })
  }
  if (restoring && before.previousStatus !== to) {
    throw new MissionControllerError('illegal_transition', {
      missionId: id,
      from,
      to,
      previousStatus: before.previousStatus
    })
  }
  const suspended = to === 'PAUSED' || to === 'BLOCKED'
  const previousStatus = restoring ? restoredPreviousStatus(ctx, id, to) : suspended ? from : null
  if (!ctx.store.updateMissionStatus({ id, from, to, previousStatus })) {
    throw new MissionControllerError('stale_state', { missionId: id, from, to })
  }
  audit(ctx, {
    missionId: id,
    actor,
    objectKind: 'mission',
    objectId: id,
    event: 'mission.status',
    before: { status: from, previousStatus: before.previousStatus },
    after: { status: to, previousStatus, reason, restoring }
  })
  return projectMission(ctx, id)
}

const StatusEventSchema = z.object({ status: MissionStatusSchema, restoring: z.boolean() })
const BeforeStatusSchema = z.object({ status: MissionStatusSchema })

function restoredPreviousStatus(
  ctx: ControllerContext,
  id: string,
  to: MissionStatus
): MissionStatus | null {
  if (to !== 'PAUSED' && to !== 'BLOCKED') {
    return null
  }
  // A single previous_status cannot encode nested pause/block. Replay the durable
  // status audit to unwind interruptions without losing the original return state.
  // ponytail: O(audit history) for nested restores; M5 can add a persisted stack if needed.
  const stack: MissionStatus[] = []
  for (const event of ctx.store.listAuditEvents({ missionId: id })) {
    if (event.event !== 'mission.status' || event.objectId !== id) {
      continue
    }
    const after = StatusEventSchema.parse(event.after)
    if (after.restoring) {
      stack.pop()
    } else if (after.status === 'PAUSED' || after.status === 'BLOCKED') {
      stack.push(BeforeStatusSchema.parse(event.before).status)
    } else {
      stack.length = 0
    }
  }
  stack.pop()
  const previous = stack.at(-1)
  if (!previous) {
    throw new MissionControllerError('illegal_transition', {
      missionId: id,
      to,
      reason: 'Missing suspension history'
    })
  }
  return previous
}

export function interruptMission(
  ctx: ControllerContext,
  id: string,
  to: 'PAUSED' | 'BLOCKED',
  reason: string
) {
  return moveMission(ctx, id, requireMission(ctx, id).status, to, 'MissionController', reason)
}

export function restoreMission(
  ctx: ControllerContext,
  id: string,
  from: 'PAUSED' | 'BLOCKED',
  reason: string | null = null
) {
  const mission = requireMission(ctx, id)
  if (mission.status !== from || !mission.previousStatus) {
    throw new MissionControllerError('illegal_transition', {
      missionId: id,
      from: mission.status,
      command: from === 'PAUSED' ? 'resume' : 'unblock'
    })
  }
  return moveMission(ctx, id, from, mission.previousStatus, 'MissionController', reason, true)
}
