import { axiomClient } from '@/lib/axiom-client'
import { translate } from '@/i18n/i18n'

export function createPolicyActions(
  mutate: (key: string, operation: (id: string) => Promise<unknown>) => Promise<boolean>,
  confirmAction: (
    title: string,
    description: string,
    action: () => Promise<unknown>,
    cancelLabel?: string,
    variant?: 'default' | 'destructive'
  ) => Promise<void>
) {
  return {
    updatePolicy: async (
      params: Parameters<typeof axiomClient.updatePolicy>[0],
      consequence: string
    ) => {
      let accepted = false
      await confirmAction(
        translate('missions.savePolicy', 'Save policy'),
        consequence,
        async () => {
          accepted = await mutate(JSON.stringify(['updatePolicy', params]), (id) =>
            axiomClient.updatePolicy(params, id)
          )
        },
        translate('missions.policyKeepEditing', 'Keep editing'),
        'default'
      )
      return accepted
    }
  }
}

export type PolicyActions = ReturnType<typeof createPolicyActions>
