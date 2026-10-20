import { getAxiomControlPlane } from './control-plane'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { ATTEMPT_RECONCILE_INTERVAL_MS, type RecoveryReport } from './recovery/recovery-service'

export function startAxiomControlPlane(runtime: OrcaRuntimeService): RecoveryReport | undefined {
  const plane = getAxiomControlPlane(runtime)
  if (plane.started) {
    return
  }
  const report = plane.recovery.recover()
  plane.started = true
  const reconcile = () => {
    void plane.recovery.reconcileAttempts().catch(() => {
      console.warn('[axiom] Attempt reconciliation failed')
    })
  }
  reconcile()
  plane.attemptReconcileTimer = setInterval(reconcile, ATTEMPT_RECONCILE_INTERVAL_MS)
  plane.attemptReconcileTimer.unref()
  for (const mission of report.missions) {
    plane.syncConsumer(mission.id)
  }
  for (const mission of report.missions) {
    if (mission.status === 'EXECUTING' && !report.blocked.some(({ id }) => id === mission.id)) {
      void plane.scheduler.scheduleRound(mission.id, 'resume').catch(() => {
        console.warn('[axiom] Scheduler round failed', { missionId: mission.id, trigger: 'resume' })
      })
    }
  }
  return report
}

export function stopAxiomControlPlane(runtime: OrcaRuntimeService): void {
  const plane = getAxiomControlPlane(runtime)
  plane.started = false
  clearInterval(plane.attemptReconcileTimer)
  plane.attemptReconcileTimer = undefined
  for (const consumer of plane.consumers.values()) {
    consumer.stop()
  }
  plane.consumers.clear()
}
