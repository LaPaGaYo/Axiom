import { getAxiomControlPlane } from './control-plane'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RecoveryReport } from './recovery/recovery-service'

export function startAxiomControlPlane(runtime: OrcaRuntimeService): RecoveryReport | undefined {
  const plane = getAxiomControlPlane(runtime)
  if (plane.started) {
    return
  }
  const report = plane.recovery.recover()
  plane.started = true
  for (const mission of report.missions) {
    plane.syncConsumer(mission.id)
  }
  return report
}

export function stopAxiomControlPlane(runtime: OrcaRuntimeService): void {
  const plane = getAxiomControlPlane(runtime)
  plane.started = false
  for (const consumer of plane.consumers.values()) {
    consumer.stop()
  }
  plane.consumers.clear()
}
