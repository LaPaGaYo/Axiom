import { recordProviderActivation } from '../provider-activation/provider-activation'
import { createCodexSessionResumeLaunchPreparation } from '../codex/codex-session-resume-launch-preparation'
import { mainProcessState as state } from './main-process-state'

const desktopResumeLaunch = createCodexSessionResumeLaunchPreparation({
  onCodexLaunch: () => {
    if (state.store) {
      recordProviderActivation(state.store, 'codex', 'agent-launch')
    }
  },
  getRuntimeHome: () => state.codexRuntimeHome,
  getSettings: () => state.store?.getSettings()
})

export const { prepareCodexSessionResumeForLaunch, prepareCodexPinnedLaunchHome } =
  desktopResumeLaunch
