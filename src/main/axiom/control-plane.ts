import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { VerificationService } from './verification/verification-service'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createAttemptLauncher } from './execution/attempt-launcher'
import { createPlannerLauncher } from './execution/planner-launcher'
import { Scheduler } from './scheduler/scheduler'
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
import { RunMailboxConsumer } from './mission-controller/run-mailbox-consumer'
import { RecoveryService } from './recovery/recovery-service'

const instances = new WeakMap<OrchestrationDb, ReturnType<typeof createControlPlane>>()

export function getAxiomControlPlane(runtime: OrcaRuntimeService) {
  const db = runtime.getOrchestrationDb()
  let instance = instances.get(db)
  if (!instance) {
    instance = createControlPlane(runtime, db)
    instances.set(db, instance)
  }
  return instance
}

function createControlPlane(runtime: OrcaRuntimeService, db: OrchestrationDb) {
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
  const missions = new MissionController(db, store, {
    onScheduleTrigger: (missionId, trigger) => {
      void scheduler.scheduleRound(missionId, trigger).catch(() => {
        console.warn('[axiom] Scheduler round failed', { missionId, trigger })
      })
    }
  })
  const scheduler = new Scheduler(db, store, missions, contextBuilder, agentFactory, {
    launch: createAttemptLauncher({ runtime, db, store, missions, artifacts })
  })
  const recovery = new RecoveryService(db, store, missions, { runtime, artifacts })
  const runtimeEpoch = `epoch_${randomUUID()}`
  const verification = new VerificationService({
    store,
    missions,
    artifacts,
    runtime,
    runtimeEpoch
  })
  const planner = createPlannerLauncher({
    runtime,
    db,
    store,
    missions,
    artifacts,
    contextBuilder,
    agentFactory
  })
  // Only process-local cancellation handles are retained; statuses, stages,
  // binding and generation are loaded from the database at each new start.
  const consumers = new Map<string, RunMailboxConsumer>()
  const lifecycle: {
    started: boolean
    bootGeneration: number
    attemptReconcileTimer?: ReturnType<typeof setInterval>
  } = {
    started: false,
    bootGeneration: 0
  }
  const plane = {
    store,
    artifacts,
    contextBuilder,
    agentFactory,
    decisionEngine,
    missions,
    scheduler,
    planner,
    recovery,
    runtimeEpoch,
    verification,
    consumers,
    ...lifecycle,
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
    const consumer = new RunMailboxConsumer(
      runtime,
      store,
      missions,
      {
        missionId,
        runId: run.id,
        consumerGeneration: run.consumer_generation
      },
      {
        onEscalation: (id) => {
          void recovery.reconcileAttempts({ missionId: id }).catch(() => {
            console.warn('[axiom] Attempt reconciliation failed', { missionId: id })
          })
        }
      }
    )
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
  mission: ReturnType<MissionController['getMission']>,
  store: AxiomStore
): MissionSummary {
  const statusAudit = store
    .listAuditEvents({ missionId: mission.id })
    .findLast(
      (event) =>
        event.event === 'mission.status' &&
        event.after !== null &&
        typeof event.after === 'object' &&
        'status' in event.after &&
        event.after.status === mission.status
    )
  const after = statusAudit?.after
  const reason = after && typeof after === 'object' && 'reason' in after ? after.reason : undefined
  return {
    id: mission.id,
    runId: mission.runId,
    reason: typeof reason === 'string' ? reason : undefined,
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
): TaskListItem & { spec: typeof task.spec } {
  return {
    id: task.taskId,
    missionId: task.missionId,
    planRevisionId: task.planRevisionId,
    title: task.title,
    stage: task.stage,
    orcaStatus: task.orcaStatus,
    spec: task.spec,
    ...(task.previousStage === null ? {} : { previousStage: task.previousStage })
  }
}
