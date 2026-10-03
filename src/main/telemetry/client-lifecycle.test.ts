import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _getBurstCapStateForTests } from './burst-cap'
import {
  _setStoreForTests,
  initTelemetry,
  persistBannerAcknowledgeWithoutEmitting,
  setOptIn,
  shutdownTelemetry,
  track,
  trackAppOpenedOnce
} from './client'
import {
  INSTALL_ID,
  cleanupTelemetryClientTest,
  setupTelemetryClientTest,
  type TelemetryClientTestState
} from './client-test-harness'

describe('telemetry lifecycle without a transport', () => {
  let state: TelemetryClientTestState
  beforeEach(() => {
    state = setupTelemetryClientTest()
  })
  afterEach(cleanupTelemetryClientTest)

  it.each([true, false])('persists optedIn=%s without processing any event', async (optedIn) => {
    state.settings.telemetry = {
      installId: INSTALL_ID,
      existedBeforeTelemetryRelease: true,
      optedIn: null
    }
    await setOptIn('settings', optedIn)
    expect(state.store.updateSettings).toHaveBeenCalledWith({
      telemetry: { installId: INSTALL_ID, existedBeforeTelemetryRelease: true, optedIn }
    })
    expect(state.settings.telemetry.optedIn).toBe(optedIn)
    expect(_getBurstCapStateForTests().perSessionCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('persists banner acknowledgment silently for compatibility', async () => {
    await persistBannerAcknowledgeWithoutEmitting()
    expect(state.settings.telemetry).toEqual({
      installId: INSTALL_ID,
      existedBeforeTelemetryRelease: false,
      optedIn: true
    })
    expect(_getBurstCapStateForTests().perSessionCount).toBe(0)
  })

  it('preserves the missing-settings fallback without emitting', async () => {
    state.settings.telemetry = undefined
    await setOptIn('settings', false)
    expect(state.settings.telemetry).toEqual({
      installId: '',
      existedBeforeTelemetryRelease: true,
      optedIn: false
    })
  })

  it('ignores preference writes before initialization', async () => {
    _setStoreForTests(null)
    await setOptIn('settings', false)
    await persistBannerAcknowledgeWithoutEmitting()
    expect(state.store.updateSettings).not.toHaveBeenCalled()
  })

  it('initializes local state and resets shutdown, burst caps, and the app-opened gate', async () => {
    trackAppOpenedOnce()
    await shutdownTelemetry()
    initTelemetry(state.store)
    expect(state.store.getSettings).toHaveBeenCalled()
    expect(_getBurstCapStateForTests().perSessionCount).toBe(0)
    trackAppOpenedOnce()
    expect(_getBurstCapStateForTests().perSessionCount).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('warns when the install id is missing and still permits settings persistence', async () => {
    state.settings.telemetry = undefined
    initTelemetry(state.store)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[telemetry] installId missing after migration')
    )
    await setOptIn('settings', false)
    expect(state.store.getSettings().telemetry?.optedIn).toBe(false)
  })

  it('shuts down immediately and idempotently without pending timers', async () => {
    track('app_opened', {})
    await expect(shutdownTelemetry()).resolves.toBeUndefined()
    await expect(shutdownTelemetry()).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    track('app_opened', {})
    expect(_getBurstCapStateForTests().perSessionCount).toBe(1)
  })
})
