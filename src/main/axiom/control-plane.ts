import path from 'node:path'
import { detectInstalledAgentsWithShellPathHydration } from '../preflight/agent-detection'
import { AgentFactory } from './agent-factory/agent-factory'
import { PROVIDER_SELECTION_RULES } from './agent-factory/provider-selection'
import { RulesEngine } from './decision-engine/rules-engine'
import { getAppEnvironment } from '../../shared/app-environment'
import { ArtifactStore } from './artifacts/artifact-store'
import { ContextBuilder } from './context-builder/context-builder'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { MissionSummary } from '../../shared/axiom-contract/mission-params'
import type { TaskListItem } from '../../shared/axiom-contract/task-params'
import { AxiomStore } from './db/axiom-store'
import { MissionController } from './mission-controller/mission-controller'
import { RunMailboxConsumer, type AxiomRuntime } from './mission-controller/run-mailbox-consumer'
import { RecoveryService } from './recovery/recovery-service'

const instances = new WeakMap<OrchestrationDb, ReturnType<typeof createControlPlane>>()

export function getAxiomControlPlane(runtime: AxiomRuntime) {
  const db = runtime.getOrchestrationDb()
  let instance = instances.get(db)
  if (!instance) {
    instance = createControlPlane(runtime, db)
    instances.set(db, instance)
  }
  return instance
}

function createControlPlane(runtime: AxiomRuntime, db: OrchestrationDb) {
  const store = new AxiomStore(db)
  const artifacts = new ArtifactStore(
    store,
    path.join(getAppEnvironment().getPath('userData'), 'axiom', 'artifacts')
  )
  const contextBuilder = new ContextBuilder(store, artifacts)
  const decisionEngine = new RulesEngine(PROVIDER_SELECTION_RULES)
  const agentFactory = new AgentFactory(
    store,
    decisionEngine,
    detectInstalledAgentsWithShellPathHydration
  )
  const missions = new MissionController(db, store)
  const recovery = new RecoveryService(db, store, missions)
  // Only process-local cancellation handles are retained; statuses, stages,
  // binding and generation are loaded from the database at each new start.
  const consumers = new Map<string, RunMailboxConsumer>()
  const plane = {
    store,
    artifacts,
    contextBuilder,
    agentFactory,
    decisionEngine,
    missions,
    recovery,
    consumers,
    started: false,
    syncConsumer
  }

  function syncConsumer(missionId: string): void {
    if (!plane.started) {
      return
    }
    const mission = missions.getMission(missionId)
    if (!['EXECUTING', 'PLANNED', 'PLAN_REVIEW', 'ANALYZING'].includes(mission.status)) {
      consumers.get(missionId)?.stop()
      consumers.delete(missionId)
      return
    }
    if (consumers.has(missionId) || recovery.recoverMission(missionId).blocked) {
      return
    }
    const run = db.getRun(mission.runId)
    if (!run) {
      return
    } // Recovery above records missing/broken Run bindings.
    const consumer = new RunMailboxConsumer(runtime, store, missions, {
      missionId,
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })
    consumers.set(missionId, consumer)
    void consumer
      .start()
      .catch(() => {
        console.warn('[axiom] Run mailbox consumer stopped unexpectedly', { missionId })
      })
      .finally(() => {
        // A quick pause/resume can already have installed a replacement.
        if (consumers.get(missionId) === consumer) {
          consumers.delete(missionId)
        }
      })
  }

  // Keep runtime wiring outside the DB-only controller. RPC callers already use
  // this per-database object, so every lifecycle entry point shares the hooks.
  const create = missions.createMission.bind(missions)
  missions.createMission = (...args) => {
    const result = create(...args)
    syncConsumer(result.mission.id)
    return result
  }
  const start = missions.startExecution.bind(missions)
  missions.startExecution = (...args) => {
    const result = start(...args)
    syncConsumer(result.id)
    return result
  }
  const resume = missions.resumeMission.bind(missions)
  missions.resumeMission = (...args) => {
    const result = resume(...args)
    syncConsumer(result.id)
    return missions.getMission(result.id)
  }
  const unblock = missions.unblockMission.bind(missions)
  missions.unblockMission = (...args) => {
    const result = unblock(...args)
    syncConsumer(result.id)
    return missions.getMission(result.id)
  }
  const pause = missions.pauseMission.bind(missions)
  missions.pauseMission = (...args) => {
    const result = pause(...args)
    syncConsumer(result.id)
    return result
  }
  const block = missions.blockMission.bind(missions)
  missions.blockMission = (...args) => {
    const result = block(...args)
    syncConsumer(result.id)
    return result
  }
  const cancel = missions.cancelMission.bind(missions)
  missions.cancelMission = (...args) => {
    const result = cancel(...args)
    syncConsumer(result.id)
    return result
  }
  return plane
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
