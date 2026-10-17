import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { PlanProposeParams } from '../../../shared/axiom-contract/plan-params'
import type { GoalBody, Provenance } from '../../../shared/axiom-contract/mission-objects'
import type { TaskStage } from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import type { AxiomStore } from '../db/axiom-store'
import {
  MissionControllerError,
  requireMission,
  requirePlan,
  requireTask,
  type ControllerContext
} from './controller-context'
import {
  createMission,
  interruptMission,
  moveMission,
  projectMission,
  restoreMission,
  type CreateMissionInput
} from './mission-lifecycle'
import { activateGoal, getGoal, proposeGoal } from './goal-lifecycle'
import { approvePlan, proposePlan, rejectPlan } from './plan-materialization'
import {
  cancelMissionTasks,
  listTasks,
  projectTask,
  recomputeReadiness,
  transitionTaskStage,
  type TransitionTaskInput
} from './task-readiness'

export { MissionControllerError, MISSION_CONTROLLER_ERROR_CODES } from './controller-context'

// The class owns transaction boundaries only. All durable state is loaded from
// the supplied database, including proposals awaiting approval after restart.
export class MissionController {
  private readonly ctx: ControllerContext
  constructor(
    db: OrchestrationDb,
    store: AxiomStore,
    deps: { now?: () => string; mintSessionId?: () => string } = {}
  ) {
    this.ctx = {
      db,
      store,
      now: deps.now ?? (() => new Date().toISOString()),
      mintSessionId: deps.mintSessionId ?? (() => `axiom-mission-${randomUUID()}`)
    }
  }

  private write<T>(operation: string, action: () => T): T {
    return runLifecycleWriteTransaction(this.ctx.db.db, `axiom_${operation}`, action)
  }

  createMission(input: CreateMissionInput) {
    return this.write('create_mission', () => createMission(this.ctx, input))
  }
  getMission(id: string) {
    return projectMission(this.ctx, id)
  }
  listMissions(filter: Parameters<AxiomStore['listMissions']>[0] = {}) {
    return this.ctx.store
      .listMissions(filter)
      .map((mission) => projectMission(this.ctx, mission.id))
  }
  proposePlan(input: z.input<typeof PlanProposeParams>) {
    return this.write('propose_plan', () => proposePlan(this.ctx, input))
  }
  approvePlan(input: { planRevisionId: string; resolver: string; provenance: Provenance }) {
    return this.write('approve_plan', () => approvePlan(this.ctx, input))
  }
  rejectPlan(input: { planRevisionId: string; reason: string; resolver: string }) {
    return this.write('reject_plan', () => rejectPlan(this.ctx, input))
  }
  getPlan(planRevisionId: string) {
    return requirePlan(this.ctx, planRevisionId)
  }
  listPlans(missionId: string) {
    requireMission(this.ctx, missionId)
    return this.ctx.store.listPlanRevisions(missionId)
  }
  getGoal(input: { missionId: string; goalRevisionId: string }) {
    return getGoal(this.ctx, input)
  }
  proposeGoal(input: { missionId: string; goal: GoalBody }) {
    return this.write('propose_goal', () => proposeGoal(this.ctx, input))
  }
  activateGoal(input: { missionId: string; goalRevisionId: string }) {
    return this.write('activate_goal', () => activateGoal(this.ctx, input))
  }
  getTask(taskId: string) {
    return projectTask(this.ctx, requireTask(this.ctx, taskId))
  }
  startExecution(missionId: string) {
    return this.write('start_execution', () => {
      const mission = requireMission(this.ctx, missionId)
      if (mission.status !== 'PLANNED' && mission.status !== 'EXECUTING') {
        throw new MissionControllerError('illegal_transition', {
          missionId,
          from: mission.status,
          to: 'EXECUTING'
        })
      }
      // Replayed/concurrent starts retain the expected PLANNED source for the CAS.
      moveMission(this.ctx, missionId, 'PLANNED', 'EXECUTING')
      recomputeReadiness(this.ctx, missionId)
      return projectMission(this.ctx, missionId)
    })
  }
  pauseMission(missionId: string, reason = 'paused by user') {
    return this.write('pause_mission', () =>
      interruptMission(this.ctx, missionId, 'PAUSED', reason)
    )
  }
  resumeMission(missionId: string, reason?: string) {
    return this.write('resume_mission', () => restoreMission(this.ctx, missionId, 'PAUSED', reason))
  }
  blockMission(missionId: string, reason: string) {
    return this.write('block_mission', () =>
      interruptMission(this.ctx, missionId, 'BLOCKED', reason)
    )
  }
  unblockMission(missionId: string) {
    return this.write('unblock_mission', () => restoreMission(this.ctx, missionId, 'BLOCKED'))
  }
  cancelMission(missionId: string, reason: string) {
    return this.write('cancel_mission', () => {
      const mission = requireMission(this.ctx, missionId)
      cancelMissionTasks(this.ctx, missionId, reason)
      return moveMission(
        this.ctx,
        missionId,
        mission.status,
        'CANCELED',
        'MissionController',
        reason
      )
    })
  }
  transitionTaskStage(input: TransitionTaskInput) {
    return this.write('transition_task_stage', () => transitionTaskStage(this.ctx, input))
  }
  cancelTask(input: { taskId: string; rationale: string; actor: string }) {
    return this.write('cancel_task', () =>
      projectTask(
        this.ctx,
        transitionTaskStage(this.ctx, {
          taskId: input.taskId,
          to: 'CANCELED',
          reason: input.rationale,
          actor: input.actor
        })
      )
    )
  }
  recomputeReadiness(missionId: string) {
    return this.write('recompute_readiness', () => recomputeReadiness(this.ctx, missionId))
  }
  listTasks(input: { missionId: string; stage?: TaskStage }) {
    return listTasks(this.ctx, input)
  }
}
