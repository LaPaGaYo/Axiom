import { getAxiomControlPlane } from './control-plane'
import { stopHeadlessAttemptWatchers } from './execution/attempt-exit-submission'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { ATTEMPT_RECONCILE_INTERVAL_MS, type RecoveryReport } from './recovery/recovery-service'

export async function startAxiomControlPlane(
  runtime: OrcaRuntimeService
): Promise<RecoveryReport | undefined> {
  const plane = getAxiomControlPlane(runtime)
  if (plane.started) {
    return
  }
  const report = plane.recovery.recover()
  plane.started = true
  const generation = ++plane.bootGeneration
  try {
    await plane.verification.recoverAtBoot()
  } catch {
    console.warn('[axiom] Verification recovery failed; continuing Control Plane startup')
  }
  if (!plane.started || generation !== plane.bootGeneration) {
    return
  }
  const reconcile = () => {
    void plane.recovery.reconcileAttempts().catch(() => {
      console.warn('[axiom] Attempt reconciliation failed')
    })
    void plane.verification.kick().catch(() => {
      console.warn('[axiom] Verification preparation failed')
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
  stopHeadlessAttemptWatchers(runtime)
  const plane = getAxiomControlPlane(runtime)
  plane.started = false
  plane.bootGeneration += 1
  void plane.verification.stop().catch(() => {
    console.warn('[axiom] Verification shutdown did not complete')
  })
  clearInterval(plane.attemptReconcileTimer)
  plane.attemptReconcileTimer = undefined
  for (const consumer of plane.consumers.values()) {
    consumer.stop()
  }
  plane.consumers.clear()
}
