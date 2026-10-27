import type { ClaudeAccountSwitchSettings } from './claude-account-switch-settings'
import type { ExternalConversationSettings } from './external-conversation-settings'
import type { NativeChatGlobalSettings } from './native-chat-appearance-settings'
import type { WorktreeDeletionPreferences } from './worktree-deletion-preferences'

/** Settings groups owned by their feature modules and composed into GlobalSettings. */
export type GlobalSettingsBase = NativeChatGlobalSettings &
  WorktreeDeletionPreferences &
  ClaudeAccountSwitchSettings &
  ExternalConversationSettings & {
    /** D83 ruling ①: one-time real-home hook and account-side hardlink cleanup. */
    codexRealHomeCleanupDone?: boolean
  }
