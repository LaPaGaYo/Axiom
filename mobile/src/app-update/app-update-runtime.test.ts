import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  subscribe: vi.fn(() => ({ remove: vi.fn() }))
}))

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.0.1' } } }))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
vi.mock('react-native', () => ({
  Platform: native.platform,
  AppState: { addEventListener: native.subscribe }
}))
vi.mock('../storage/app-update-preferences', () => {
  const empty = { lastCheckedAt: null, latest: null, dismissedVersion: null }
  return {
    EMPTY_APP_UPDATE_PREFERENCES: empty,
    loadAppUpdatePreferences: vi.fn(async () => empty),
    saveAppUpdateCheck: vi.fn(),
    saveDismissedAppUpdateVersion: vi.fn()
  }
})

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Axiom native update policy', () => {
  it.each(['ios', 'android'])('makes no update request on %s', async (platform) => {
    native.platform.OS = platform
    const { appUpdateChecker } = await import('./app-update-runtime')
    const stop = appUpdateChecker.start()
    try {
      await vi.advanceTimersByTimeAsync(0)
      await expect(appUpdateChecker.checkNow()).resolves.toBe('failed')
      expect(fetch).not.toHaveBeenCalled()
      expect(appUpdateChecker.getSnapshot().lastCheckedAt).toBeNull()
    } finally {
      stop()
    }
  })
})
