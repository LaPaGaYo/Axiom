import { isOrcaSessionId } from '../../../shared/orca-session-address'
import {
  TERMINAL_MISSION_STATUSES,
  type MissionStatus
} from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { runBoundToCoordinator } from '../../runtime/orchestration/orchestration-caller-identity'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'

export type RecoveryReport = {
  missions: { id: string; status: MissionStatus; moved: string[] }[]
  blocked: { id: string; reason: 'run_binding_lost' }[]
}

export class RecoveryService {
  constructor(
    private readonly db: OrchestrationDb,
    private readonly store: AxiomStore,
    private readonly missions: MissionController
  ) {}

  reconcileAttempts(): 'no_attempts_in_m1' {
    // M2 must reconcile execution-host liveness before dispatching any Attempts.
    return 'no_attempts_in_m1'
  }

  recover(): RecoveryReport {
    this.reconcileAttempts()
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
