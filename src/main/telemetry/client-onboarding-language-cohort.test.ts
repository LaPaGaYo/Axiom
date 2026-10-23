import { afterEach, describe, expect, it, vi } from 'vitest'
import { initTelemetry, track } from './client'
import { cleanupTelemetryClientTest, setupTelemetryClientTest } from './client-test-harness'

const { capture } = vi.hoisted(() => {
  vi.stubGlobal('ORCA_BUILD_IDENTITY', 'stable')
  vi.stubGlobal('ORCA_POSTHOG_WRITE_KEY', 'test-key')
  return { capture: vi.fn() }
})

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = capture
  }
}))

afterEach(() => capture.mockClear())

describe('onboarding language cohort on analytics', () => {
  it.each(['control', 'treatment', undefined] as const)(
    'keeps %s cohort events local regardless of consent',
    (cohort) => {
      const state = setupTelemetryClientTest({
        optedIn: true,
        installId: 'test-install',
        existedBeforeTelemetryRelease: false,
        ...(cohort ? { onboardingLanguageCohort: cohort } : {})
      })
      try {
        initTelemetry(state.store)
        track('onboarding_completed', { path: 'open_folder', total_duration_ms: 1000 })
        track('activation_checklist_item_completed', {
          item: 'ranFirstAgent',
          time_since_completed_ms: 2000
        })
        expect(capture).not.toHaveBeenCalled()
        if (state.settings.telemetry) {
          state.settings.telemetry.optedIn = false
        }
        track('app_opened', {})
        expect(capture).not.toHaveBeenCalled()
      } finally {
        cleanupTelemetryClientTest()
      }
    }
  )
})
