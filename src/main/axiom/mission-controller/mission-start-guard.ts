import {
  MissionControllerError,
  requireMission,
  type ControllerContext
} from './controller-context'
import { moveMission, projectMission } from './mission-lifecycle'
import { recomputeReadiness } from './task-readiness'

export function assertMissionStartable(ctx: ControllerContext, missionId: string) {
  const mission = requireMission(ctx, missionId)
  if (mission.status !== 'PLANNED' && mission.status !== 'EXECUTING') {
    throw new MissionControllerError('illegal_transition', {
      missionId,
      from: mission.status,
      to: 'EXECUTING'
    })
  }
  if (mission.status === 'EXECUTING') {
    throw new MissionControllerError('stale_state', {
      missionId,
      from: 'PLANNED',
      to: 'EXECUTING',
      actual: 'EXECUTING'
    })
  }
  const holder = ctx.store.listMissions({}).find(
    (other) =>
      other.id !== missionId &&
      (other.repoId === mission.repoId || other.repoPath === mission.repoPath) &&
      other.targetBranch === mission.targetBranch &&
      (['EXECUTING', 'REPLANNING', 'FINALIZING', 'READY_FOR_APPROVAL'].includes(other.status) ||
        (['PAUSED', 'BLOCKED'].includes(other.status) &&
          // Nested or missing history cannot prove that execution never started.
          !['DRAFT', 'ANALYZING', 'PLAN_REVIEW', 'PLANNED'].includes(other.previousStatus ?? '')))
  )
  if (holder) {
    throw new MissionControllerError('mission_target_busy', {
      missionId,
      heldBy: holder.id,
      repoPath: mission.repoPath,
      targetBranch: mission.targetBranch,
      reason: `Mission ${holder.id} already occupies this repository and target branch.`
    })
  }
  return mission
}

export function startExecution(ctx: ControllerContext, missionId: string) {
  assertMissionStartable(ctx, missionId)
  // Replayed/concurrent starts retain the expected PLANNED source for the CAS.
  moveMission(ctx, missionId, 'PLANNED', 'EXECUTING')
  recomputeReadiness(ctx, missionId)
  return projectMission(ctx, missionId)
}
