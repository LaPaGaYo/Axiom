import { TERMINAL_TASK_STAGES } from '../../../shared/axiom-contract/lifecycle'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { EffectOutbox } from '../outbox/effect-outbox'

export function requestFinalization(
  store: AxiomStore,
  missions: Pick<MissionController, 'startFinalization'>,
  effects: Pick<EffectOutbox, 'enqueue'>,
  missionId: string
): void {
  try {
    store.transaction('finalization_requested', () => {
      const mission = store.getMission(missionId)
      if (mission?.status === 'EXECUTING') {
        const tasks = store.listTaskStages({ missionId })
        if (
          !tasks.some((task) => task.stage === 'INTEGRATED') ||
          !tasks.every((task) => TERMINAL_TASK_STAGES.has(task.stage))
        ) {
          return
        }
        missions.startFinalization(missionId)
      } else if (mission?.status !== 'FINALIZING') {
        return
      }
      const effect = store.getEffect('mission.finalize', missionId)
      if (effect?.status !== 'pending' && effect?.status !== 'running') {
        effects.enqueue({ kind: 'mission.finalize', missionId, key: missionId, payload: {} })
      }
    })
  } catch {
    console.warn('[axiom] Finalization request failed', { missionId })
  }
}
