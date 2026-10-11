import type { GlobalSettings } from '../../shared/global-settings-types'
import type {
  ProviderActivationId,
  ProviderActivationSource
} from '../../shared/provider-activation'

type ActivationSettings = Pick<GlobalSettings, 'providerActivations'>
export type ProviderActivationStore = {
  getSettings: () => ActivationSettings
  updateSettings: (
    updates: Partial<GlobalSettings>,
    options?: { notifyListeners?: boolean }
  ) => unknown
}

export function isProviderActivated(
  settings: ActivationSettings | null | undefined,
  id: ProviderActivationId
): boolean {
  return settings?.providerActivations?.[id] !== undefined
}

export function recordProviderActivation(
  store: ProviderActivationStore,
  id: ProviderActivationId,
  source: ProviderActivationSource
): void {
  const settings = store.getSettings()
  if (isProviderActivated(settings, id)) {
    return
  }
  store.updateSettings(
    {
      providerActivations: {
        ...settings.providerActivations,
        [id]: { activatedAt: new Date().toISOString(), source }
      }
    },
    { notifyListeners: true }
  )
}
