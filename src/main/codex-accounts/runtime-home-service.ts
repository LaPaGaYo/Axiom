import type { Store } from '../persistence'
import { CodexRuntimeHomeAuthSync } from './runtime-home-service-auth-sync'

export type {
  CodexMirroredHomeStatus,
  CodexRateLimitHomeResolution
} from './runtime-home-service-types'

export class CodexRuntimeHomeService extends CodexRuntimeHomeAuthSync {
  constructor(store: Store) {
    super(store)
    // D83 ruling ①: do not create or recover the retired host mirror.
    if (process.platform === 'win32') {
      this.safeRecoverInterruptedRuntimeAuthOperation()
      this.safeMigrateLegacySharedAuth()
      this.safeMigrateLegacyManagedState()
      this.safeMigrateLegacyActiveHomePointer()
    }
    this.initializeLastSyncedState()
    this.safeSyncForCurrentSelection()
  }
}
