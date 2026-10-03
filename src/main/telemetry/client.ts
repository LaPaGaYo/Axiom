// Keep the typed event vocabulary and local validation while V1 has no telemetry sink.
import type { EventName, EventProps, OptInVia } from '../../shared/telemetry-events'
import type { Store } from '../persistence'
import { consumeBurstToken, resetBurstCapsForSession } from './burst-cap'
import { getCohortAtEmit } from './cohort-classifier'
import { validate } from './validator'

type TelemetryStore = Pick<Store, 'getSettings' | 'updateSettings'>

let storeRef: TelemetryStore | null = null
let shuttingDown = false
let appOpenedTrackedThisSession = false

export function initTelemetry(store: TelemetryStore): void {
  storeRef = store
  resetBurstCapsForSession()
  shuttingDown = false
  appOpenedTrackedThisSession = false

  // Preserve the migration invariant check even though no identifier leaves the process.
  if (!store.getSettings().telemetry?.installId) {
    console.warn('[telemetry] installId missing after migration')
  }
}

export function track<N extends EventName>(name: N, props: EventProps<N>): void {
  if (shuttingDown) {
    return
  }
  // Validation remains active for every consent/build state so malformed call sites stay visible.
  if (!validate(name, props).ok) {
    return
  }
  // D25: discard immediately; no sink, queue, or network transport exists in V1.
  void consumeBurstToken(name)
}

export async function setOptIn(_via: OptInVia, optedIn: boolean): Promise<void> {
  if (!storeRef) {
    return
  }
  const settings = storeRef.getSettings()
  // Keep the persisted shape for compatibility without emitting a consent event.
  storeRef.updateSettings({
    telemetry: {
      ...(settings.telemetry ?? { installId: '', existedBeforeTelemetryRelease: true }),
      optedIn
    }
  })
}

export function persistBannerAcknowledgeWithoutEmitting(): Promise<void> {
  return setOptIn('first_launch_banner', true)
}

export function trackAppOpenedOnce(): void {
  if (appOpenedTrackedThisSession) {
    return
  }
  appOpenedTrackedThisSession = true
  track('app_opened', { ...getCohortAtEmit() })
}

export async function shutdownTelemetry(): Promise<void> {
  shuttingDown = true
}

export function _setStoreForTests(store: TelemetryStore | null): void {
  storeRef = store
}

export function _setShuttingDownForTests(value: boolean): void {
  shuttingDown = value
}

export function _resetFirstAppOpenedFiredForTests(): void {
  appOpenedTrackedThisSession = false
}
