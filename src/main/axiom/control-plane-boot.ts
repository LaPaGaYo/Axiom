import { getAxiomControlPlane } from './control-plane'
import type { AxiomRuntime } from './mission-controller/run-mailbox-consumer'
import type { RecoveryReport } from './recovery/recovery-service'

export function startAxiomControlPlane(runtime: AxiomRuntime): RecoveryReport | undefined {
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

export function stopAxiomControlPlane(runtime: AxiomRuntime): void {
  const plane = getAxiomControlPlane(runtime)
  plane.started = false
  for (const consumer of plane.consumers.values()) {
    consumer.stop()
  }
  plane.consumers.clear()
}
