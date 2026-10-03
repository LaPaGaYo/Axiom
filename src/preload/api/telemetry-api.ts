import type { MemorySnapshot, StatsSummary } from '../../shared/process-stats-types'

export type StatsApi = {
  getSummary: () => Promise<StatsSummary>
}

// Diagnostics IPC payloads; mirror the runtime types in `src/main/observability/{index,bundle}.ts`.
export type DiagnosticsStatusPayload = {
  readonly localFileEnabled: boolean
  readonly bundleEnabled: boolean
  readonly traceFilePath: string
  readonly traceFamilySize: number
  readonly disabledReason?:
    | 'do_not_track'
    | 'orca_telemetry_disabled'
    | 'orca_diagnostics_disabled'
    | 'ci'
}
export type DiagnosticsBundlePayload = {
  readonly bundleSubmissionId: string
  readonly bytes: number
  readonly spanCount: number
}
export type DiagnosticsUploadPayload =
  | {
      readonly ticketId: string
    }
  | {
      readonly canceled: true
    }

export type MemoryApi = {
  getSnapshot: () => Promise<MemorySnapshot>
}

export type DiagnosticsApi = {
  getStatus: () => Promise<DiagnosticsStatusPayload>
  collectBundle: (lookbackMinutes?: number) => Promise<DiagnosticsBundlePayload>
  openBundlePreview: (bundleSubmissionId: string) => Promise<void>
  discardBundlePreview: (bundleSubmissionId: string) => Promise<void>
  uploadBundle: (bundleSubmissionId: string) => Promise<DiagnosticsUploadPayload>
  deleteBundle: (ticketId: string) => Promise<void>
}

export type TelemetryApi = {
  /** Fire-and-forget track. Loose IPC typing on purpose — the main-side validator enforces;
   *  renderer sites should import `track<N>()` from lib/telemetry.ts, not reach here. */
  telemetryTrack: (name: string, props: Record<string, unknown>) => Promise<void>
  /** Diagnostic file controls (telemetry-error-tracking.md §User controls). Main does the FS/network
   *  work and retains upload payloads so the renderer can't read or substitute arbitrary bytes. */
  diagnostics: DiagnosticsApi
  stats: StatsApi
  memory: MemoryApi
}
