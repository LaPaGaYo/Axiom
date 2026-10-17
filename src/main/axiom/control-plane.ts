import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { MissionSummary } from '../../shared/axiom-contract/mission-params'
import type { TaskListItem } from '../../shared/axiom-contract/task-params'
import { AxiomStore } from './db/axiom-store'
import { MissionController } from './mission-controller/mission-controller'

const instances = new WeakMap<OrchestrationDb, { store: AxiomStore; missions: MissionController }>()

export function getAxiomControlPlane(runtime: OrcaRuntimeService) {
  const db = runtime.getOrchestrationDb()
  let instance = instances.get(db)
  if (!instance) {
    const store = new AxiomStore(db)
    instance = { store, missions: new MissionController(db, store) }
    instances.set(db, instance)
  }
  return instance
}

export function missionSummary(
  mission: ReturnType<MissionController['getMission']>
): MissionSummary {
  return {
    id: mission.id,
    repoId: mission.repoId,
    repoPath: mission.repoPath,
    targetBranch: mission.targetBranch,
    status: mission.status,
    activeGoalRevisionId: mission.activeGoalRevisionId,
    activePlanRevisionId: mission.activePlanRevisionId
  }
}

export function taskListItem(
  task: ReturnType<MissionController['listTasks']>[number]
): TaskListItem {
  return {
    id: task.taskId,
    missionId: task.missionId,
    planRevisionId: task.planRevisionId,
    title: task.title,
    stage: task.stage,
    orcaStatus: task.orcaStatus,
    ...(task.previousStage === null ? {} : { previousStage: task.previousStage })
  }
}
