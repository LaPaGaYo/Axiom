import { isOrcaSessionId } from '../../../shared/orca-session-address'
import {
  TERMINAL_MISSION_STATUSES,
  TERMINAL_TASK_STAGES,
  type MissionStatus
} from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { runBoundToCoordinator } from '../../runtime/orchestration/orchestration-caller-identity'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import { reconcileAttempt } from './attempt-reconciliation'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'

export const ATTEMPT_RECONCILE_INTERVAL_MS = 60_000
export type AttemptReconcileReport = { attempts: AttemptReconcileEntry[] }

export type RecoveryReport = {
  missions: { id: string; status: MissionStatus; moved: string[] }[]
  blocked: { id: string; reason: 'run_binding_lost' }[]
}

export class RecoveryService {
  private inFlight: Promise<AttemptReconcileReport> | undefined

  constructor(
    private readonly db: OrchestrationDb,
    private readonly store: AxiomStore,
    private readonly missions: MissionController,
    private readonly deps: Pick<RecoveryContext, 'runtime' | 'artifacts'> & { now?: () => number }
  ) {}

  async reconcileAttempts(filter?: { missionId?: string }): Promise<AttemptReconcileReport> {
    if (this.inFlight) {
      await this.inFlight
      // A cancel or a different Mission may arrive during host IO. Re-read after the active pass.
      return this.reconcileAttempts(filter)
    }
    const pending = this.reconcileAttemptBindings(filter)
    this.inFlight = pending
    try {
      return await pending
    } finally {
      this.inFlight = undefined
    }
  }

  private async reconcileAttemptBindings(filter?: {
    missionId?: string
  }): Promise<AttemptReconcileReport> {
    const bindings = new Map<string, AttemptBinding>()
    for (const mission of this.store.listMissions({})) {
      if (filter?.missionId && mission.id !== filter.missionId) {
        continue
      }
      for (const binding of this.store.listAttemptBindings({ missionId: mission.id })) {
        const stage = this.store.getTaskStage(binding.taskId)?.stage
        if (
          stage &&
          (!TERMINAL_TASK_STAGES.has(stage) ||
            stage === 'CANCELED' ||
            TERMINAL_MISSION_STATUSES.has(mission.status))
        ) {
          bindings.set(`${binding.taskId}/${binding.seq}`, binding)
        }
      }
    }
    for (const row of this.db.listLegacyWorkerTerminalRecoveryRows()) {
      const binding = this.store.getAttemptBindingByDispatch(row.dispatch_id)
      if (binding && (!filter?.missionId || binding.missionId === filter.missionId)) {
        bindings.set(`${binding.taskId}/${binding.seq}`, binding)
      }
    }
    const ctx: RecoveryContext = {
      db: this.db,
      store: this.store,
      missions: this.missions,
      ...this.deps,
      now: this.deps.now ?? Date.now
    }
    const attempts: AttemptReconcileEntry[] = []
    for (const binding of bindings.values()) {
      try {
        attempts.push(await reconcileAttempt(ctx, binding))
      } catch {
        // Keep other Attempts converging; neither a transport error nor an unknown stop proves exit.
        console.warn('[axiom] Attempt reconciliation failed', {
          taskId: binding.taskId,
          seq: binding.seq
        })
        attempts.push({
          attemptId: binding.dispatchId,
          taskId: binding.taskId,
          seq: binding.seq,
          liveness: null,
          action: 'reconcile_failed'
        })
      }
    }
    return { attempts }
  }

  recover(): RecoveryReport {
    const report: RecoveryReport = { missions: [], blocked: [] }
    for (const mission of this.store.listMissions({})) {
      if (TERMINAL_MISSION_STATUSES.has(mission.status)) {
        continue
      }
      const { blocked, ...result } = this.recoverMission(mission.id)
      report.missions.push(result)
      if (blocked) {
        report.blocked.push({ id: mission.id, reason: 'run_binding_lost' })
      }
    }
    return report
  }

  recoverMission(id: string) {
    return this.store.transaction('recover_mission', () => {
      const mission = this.missions.getMission(id)
      const run = this.db.getRun(mission.runId)
      const blocked =
        !isOrcaSessionId(mission.coordinatorOrcaSessionId) ||
        !run ||
        !runBoundToCoordinator(run, {
          terminalHandle: null,
          paneKey: null,
          orcaSessionId: mission.coordinatorOrcaSessionId
        })
      if (blocked) {
        if (mission.status !== 'BLOCKED') {
          this.missions.blockMission(id, 'run_binding_lost')
        }
        // Repeated recovery of an unchanged lost binding must not grow the audit.
        if (
          !this.store
            .listAuditEvents({ missionId: id })
            .some((event) => event.event === 'recovery.run_binding_lost')
        ) {
          this.store.appendAuditEvent({
            missionId: id,
            actor: 'RecoveryService',
            objectKind: 'mission',
            objectId: id,
            event: 'recovery.run_binding_lost',
            before: null,
            after: { runId: mission.runId, reason: 'run_binding_lost' }
          })
        }
      }
      return {
        id,
        status: this.missions.getMission(id).status,
        moved: blocked ? [] : this.missions.recomputeReadiness(id),
        blocked
      }
    })
  }
}
