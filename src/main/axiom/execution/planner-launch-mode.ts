import {
  decideWorkerStartMode,
  readWorkerStartModeSettings
} from '../../runtime/rpc/methods/orchestration-worker-start-mode'

export function plannerAwareStartMode(
  runtime: Parameters<typeof readWorkerStartModeSettings>[0],
  params: Parameters<typeof decideWorkerStartMode>[0]['params'],
  planner: boolean
) {
  return decideWorkerStartMode({
    params,
    // Mission Claude's policy is on the structured channel; saved terminal preferences cannot
    // bypass it. The existing host-support check still owns any unsupported-host downgrade.
    settings:
      planner && params.agent === 'claude'
        ? { experimentalNativeChat: true }
        : readWorkerStartModeSettings(runtime)
  })
}
