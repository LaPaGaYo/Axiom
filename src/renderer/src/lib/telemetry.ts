// Typed renderer entry point; main validates and discards events locally in V1.
import type { EventName, EventProps } from '../../../shared/telemetry-events'

export { tuiAgentToAgentKind } from '../../../shared/agent-kind'

export function track<N extends EventName>(name: N, props: EventProps<N>): void {
  // Why: telemetry is fire-and-forget and must never throw into the renderer; log (don't rethrow/silently swallow) so IPC failures leave a breadcrumb.
  try {
    void window.api?.telemetryTrack?.(name, props)?.catch((err) => {
      console.warn('[telemetry] IPC track failed', err)
    })
  } catch (err) {
    console.warn('[telemetry] IPC track threw synchronously', err)
  }
}
