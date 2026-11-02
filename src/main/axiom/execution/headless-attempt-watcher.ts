import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { submitExitedAttempt } from './attempt-exit-submission'

const watchers = new WeakMap<OrcaRuntimeService, Map<string, ReturnType<typeof setInterval>>>()
export function watchHeadlessAttempt(runtime: OrcaRuntimeService, attemptId: string) {
  let timers = watchers.get(runtime)
  if (!timers) {
    timers = new Map()
    watchers.set(runtime, timers)
  }
  if (timers.has(attemptId)) {
    return
  }
  let busy = false
  const stop = () => {
    clearInterval(timer)
    timers.delete(attemptId)
  }
  const timer = setInterval(() => {
    if (busy) {
      return
    }
    busy = true
    void submitExitedAttempt(runtime, attemptId)
      .then((result) => {
        if (result !== 'pending') {
          stop()
        }
      })
      .catch(() => {
        // Recovery retries from the same durable exit file after an IO/DB failure.
        stop()
        console.warn('[axiom] Headless exit settlement deferred to recovery', { attemptId })
      })
      .finally(() => {
        busy = false
      })
  }, 250)
  timer.unref()
  timers.set(attemptId, timer)
}

export function stopHeadlessAttemptWatchers(runtime: OrcaRuntimeService) {
  for (const timer of watchers.get(runtime)?.values() ?? []) {
    clearInterval(timer)
  }
  watchers.delete(runtime)
}
