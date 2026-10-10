import { describe, expect, it, vi } from 'vitest'
import { RuntimeClientSettingsController } from './runtime-client-settings'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import { applyAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import type { GlobalSettings } from '../../shared/global-settings-types'

vi.mock('../agent-hooks/managed-agent-hook-controls', () => ({
  applyAgentStatusHooksEnabled: vi.fn()
}))
vi.mock('../agent-hooks/install-telemetry', () => ({ recordManagedHookInstallFailure: vi.fn() }))

describe('paired Settings provider activation', () => {
  it('records the requested Codex hook install before reconciliation', async () => {
    let settings = createGlobalSettingsFixture({ agentStatusHooksEnabled: false })
    const store = {
      getSettings: () => settings,
      updateSettings: (updates: Partial<GlobalSettings>) => {
        settings = { ...settings, ...updates }
      }
    }
    vi.mocked(applyAgentStatusHooksEnabled).mockImplementation(async () => {
      expect(settings.providerActivations?.codex?.source).toBe('settings-hook-install')
      return []
    })
    await new RuntimeClientSettingsController(store).update({ agentStatusHooksEnabled: true })
    expect(applyAgentStatusHooksEnabled).toHaveBeenCalledWith(
      true,
      expect.any(Object),
      expect.objectContaining({ userInitiated: true })
    )
  })
})
