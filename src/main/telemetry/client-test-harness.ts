import { vi } from 'vitest'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { resetBurstCapsForSession } from './burst-cap'
import {
  _resetFirstAppOpenedFiredForTests,
  _setShuttingDownForTests,
  _setStoreForTests
} from './client'
import { _resetValidatorWarnCacheForTests } from './validator'

export const INSTALL_ID = '00000000-0000-4000-8000-000000000000'

export function setupTelemetryClientTest(
  telemetry: GlobalSettings['telemetry'] = {
    optedIn: true,
    installId: INSTALL_ID,
    existedBeforeTelemetryRelease: false
  }
) {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers()
  resetBurstCapsForSession()
  _resetValidatorWarnCacheForTests()
  const settings = createGlobalSettingsFixture({ telemetry })
  const store = {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
      if (updates.telemetry) {
        settings.telemetry = { ...settings.telemetry, ...updates.telemetry }
      }
      return settings
    })
  }
  _setStoreForTests(store)
  _setShuttingDownForTests(false)
  _resetFirstAppOpenedFiredForTests()
  return { store, settings }
}

export type TelemetryClientTestState = ReturnType<typeof setupTelemetryClientTest>

export function cleanupTelemetryClientTest(): void {
  _setStoreForTests(null)
  _setShuttingDownForTests(false)
  _resetFirstAppOpenedFiredForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
}
