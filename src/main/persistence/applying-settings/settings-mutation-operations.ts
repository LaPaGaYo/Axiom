import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { ProtectedSecretPersistence } from '../../protected-secret-persistence'

export type SettingsMutationOperations = {
  state: PersistedState
  bumpLocalWorktreeScanGeneration: (repoId: string) => void
  removeRetainedBlob: ProtectedSecretPersistence['removeRetainedBlob']
  scheduleSave: () => void
  notifySettingsChanged: (updates: Partial<GlobalSettings>, originWebContentsId?: number) => void
}
