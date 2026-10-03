import type { PreloadApi } from '../../../../preload/api-types'

export function createWebTelemetryApi(): Partial<PreloadApi> {
  return {
    telemetryTrack: () => Promise.resolve()
  }
}
