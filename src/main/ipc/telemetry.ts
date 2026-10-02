// Renderer events retain the main-owned validation boundary even without a telemetry sink.
// No consent channels remain because V1 has no product telemetry to authorize.

import { ipcMain } from 'electron'
import { track } from '../telemetry/client'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import { getOnboardingCohortAtEmit } from '../telemetry/onboarding-cohort-classifier'
import type { Store } from '../persistence'
import { isCohortExtendedEvent, isOnboardingEvent } from '../../shared/telemetry-events'
import type { EventName, EventProps } from '../../shared/telemetry-events'

const MAIN_OWNED_TELEMETRY_EVENTS = new Set<EventName>([
  'app_starred_orca',
  'daemon_adopted',
  'daemon_audit_eligibility',
  'daemon_pty_cwd_denied',
  'daemon_pty_cwd_readable',
  'star_nag_outcome',
  'feature_interaction_usage_bucket_reached'
])

// Keep the optional store parameter compatible with the existing core-handler registration.
export function registerTelemetryHandlers(_store?: Store): void {
  ipcMain.handle('telemetry:track', (_event, name: unknown, props: unknown): void => {
    // Drop non-string names at the boundary so a flood of bogus payloads never reaches the Zod validator.
    if (typeof name !== 'string') {
      return
    }
    // `props` is optional (undefined/null → {} below); reject any other non-object at the boundary.
    if (props !== null && props !== undefined && typeof props !== 'object') {
      return
    }
    const eventName = name as EventName
    // Why: these events are main-owned; renderer IPC emitting them would let compromised content spoof product outcomes.
    if (MAIN_OWNED_TELEMETRY_EVENTS.has(eventName)) {
      return
    }
    // Inject cohort props only for schemas that declare them: schemas are `.strict()`, so an extra prop on any other event fails Zod and drops it.
    const baseProps = (props ?? {}) as Record<string, unknown>
    const withRepoCohort = isCohortExtendedEvent(eventName)
      ? { ...baseProps, ...getCohortAtEmit() }
      : baseProps
    const finalProps = isOnboardingEvent(eventName)
      ? { ...withRepoCohort, ...getOnboardingCohortAtEmit() }
      : withRepoCohort
    // Casts are pass-through only; `track()`'s validator is the single runtime enforcement point, not these casts.
    track(eventName, finalProps as EventProps<EventName>)
  })
}
