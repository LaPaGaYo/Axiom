import { axiomClient } from '@/lib/axiom-client'
import { translate } from '@/i18n/i18n'
import type { StallMode } from '../../../../shared/axiom-contract/supervision'
import { stallStopConsequence } from './stall-mode-copy'

export function createSupervisionActions(
  mutate: (key: string, operation: (id: string) => Promise<unknown>) => Promise<boolean>,
  confirmAction: (
    title: string,
    description: string,
    action: () => Promise<unknown>,
    cancelLabel?: string
  ) => Promise<void>
) {
  const confirmStop = async (global: boolean, action: () => Promise<boolean>) => {
    let accepted = false
    await confirmAction(
      translate('missions.stopStalledWorkers', 'Stop stalled Workers automatically'),
      stallStopConsequence(global),
      async () => {
        accepted = await action()
      },
      translate('missions.keepCurrentStallMode', 'Keep the current mode')
    )
    return accepted
  }
  return {
    updateSupervision: (params: Parameters<typeof axiomClient.updateSupervision>[0]) => {
      const run = () =>
        mutate(JSON.stringify(['updateSupervision', params]), (id) =>
          axiomClient.updateSupervision(params, id)
        )
      return params.mode === 'stop' ? confirmStop(!params.missionId, run) : run()
    },
    resolveSupervision: (
      params: Parameters<typeof axiomClient.resolveSupervision>[0],
      toMode: StallMode
    ) => {
      const run = () =>
        mutate(JSON.stringify(['resolveSupervision', params]), (id) =>
          axiomClient.resolveSupervision(params, id)
        )
      return params.resolution === 'accept' && toMode === 'stop' ? confirmStop(true, run) : run()
    }
  }
}

export type SupervisionActions = ReturnType<typeof createSupervisionActions>
