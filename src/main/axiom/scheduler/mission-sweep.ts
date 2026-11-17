import { getMainE2EConfig } from '../../e2e-config'
import type { AxiomStore } from '../db/axiom-store'
import type { Scheduler } from './scheduler'

export function shouldHoldSweep(): boolean {
  return getMainE2EConfig().enabled && process.env.AXIOM_E2E_RUN_SWEEP !== '1'
}

export function sweepExecutingMissions(
  store: Pick<AxiomStore, 'listMissions'>,
  scheduler: Pick<Scheduler, 'scheduleRound'>
): void {
  try {
    if (shouldHoldSweep()) {
      return
    }
    for (const { id: missionId } of store.listMissions({ status: 'EXECUTING' })) {
      void scheduler.scheduleRound(missionId, 'sweep').catch(() => {
        console.warn('[axiom] Scheduler round failed', { missionId, trigger: 'sweep' })
      })
    }
  } catch {
    console.warn('[axiom] Scheduler sweep failed')
  }
}
