import { ipcMain } from 'electron'
import { PRODUCT_EGRESS_POLICY } from '../../shared/product-egress-policy'
import type { AgentValueMomentPreparation } from './agent-value-moment'

/** Existing renderers may still report onboarding or support actions when the prompt is disabled. */
function registerDisabledStarNagHandlers(): void {
  for (const action of [
    'dismiss',
    'later',
    'complete',
    'disable',
    'openWeb',
    'forceShow',
    'showAgentValueMoment',
    'onboardingCompleted'
  ]) {
    ipcMain.handle(`star-nag:${action}`, (): void => {})
  }
  ipcMain.handle('star-nag:starOrca', (): boolean => false)
  ipcMain.handle('star-nag:agentValueMoment', (): AgentValueMomentPreparation => ({
    status: 'skipped'
  }))
}

export function registerStarNagHandlers(handlers: Record<string, () => unknown>): void {
  if (PRODUCT_EGRESS_POLICY.starPromptRepository === null) {
    registerDisabledStarNagHandlers()
    return
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler)
  }
}
