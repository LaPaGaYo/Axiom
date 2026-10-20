import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { describeUnconfirmedAgentStop } from '../../../../../../shared/pty-liveness-verdict'
import { inspectWorkerTerminal } from './worker-observation'
import {
  resolveStructuredWorkerForDispatch,
  stopStructuredWorker
} from '../../orchestration-structured-worker-lifecycle'
import { isStructuredWorkerHandle } from '../../../../structured-worker-identity'

export function stopLocalWorker(runtime: OrcaRuntimeService, dispatchId: string): Promise<unknown> {
  return dedupeWorkerStop(runtime, dispatchId, async () => {
    const db = runtime.getOrchestrationDb()
    const begun = db.beginWorkerStop(dispatchId, runtime.getRuntimeId())
    if (begun.disposition === 'already_settled') {
      return settledReceipt(dispatchId, begun.worker.state)
    }
    if (begun.disposition === 'context_only') {
      if (!begun.alreadySettled) {
        runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
      }
      return {
        dispatchId: dispatchId,
        state: begun.state,
        alreadySettled: begun.alreadySettled,
        processAction: 'none' as const,
        warning: contextOnlyStopWarning(begun)
      }
    }
    const handle = begun.worker.agent_terminal_handle
    if (!handle) {
      return unknownReceipt(
        dispatchId,
        db.markWorkerStopUnknown(dispatchId, 'The Dispatch has no recorded agent terminal.'),
        'unknown'
      )
    }
    if (isStructuredWorkerHandle(handle)) {
      // The same install release performs, for the same reason: after a restart nothing has
      // installed the structured host, and both the observation below and the close read it.
      // Without this a restarted worker answers `unknown` forever and can never be stopped.
      await runtime.ensureStructuredAgentSessionHost().catch((error: unknown) => {
        console.warn('[orchestration] structured host install failed before stop', handle, error)
      })
    }
    const observation = await inspectWorkerTerminal(runtime, db, dispatchId)
    // The host exit can settle this stop while terminal inspection is awaiting inventory.
    if (db.getWorkerDispatch(dispatchId)?.state === 'stopped') {
      runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
      return {
        dispatchId: dispatchId,
        state: 'stopped',
        alreadySettled: false,
        processAction: 'none'
      }
    }
    // Why `unverifiable` still proceeds: losing contact is a reason to report
    // the outcome honestly, never a reason to stop trying to stop the worker.
    if (
      !observation.exact ||
      (observation.status !== 'live' && observation.status !== 'unverifiable')
    ) {
      return unknownReceipt(
        dispatchId,
        db.markWorkerStopUnknown(
          dispatchId,
          `The recorded worker process is ${observation.status}; no terminal was closed.`
        ),
        'none'
      )
    }
    const resource = db.getWorkerTerminalResourceByOwner(dispatchId)
    if (!resource || resource.ownership_state !== 'owned') {
      const ownership = resource?.ownership_state ?? 'unproven'
      return unknownReceipt(
        dispatchId,
        db.markWorkerStopUnknown(
          dispatchId,
          `The worker terminal is ${ownership}; no terminal was closed.`
        ),
        'none'
      )
    }
    const structured = resolveStructuredWorkerForDispatch(db, dispatchId)
    if (structured) {
      const stop = await stopStructuredWorker(structured, dispatchId, runtime)
      if (!stop.stopped) {
        // Close is retried by the host; only a proven exit may settle the dispatch. And when no
        // close was issued at all — no host in this runtime generation — the receipt says so
        // rather than crediting this runtime with a terminal it never touched.
        return unknownReceipt(
          dispatchId,
          db.markWorkerStopUnknown(dispatchId, stop.reason ?? 'The close was not proven.'),
          stop.closeAttempted ? 'closed_agent_terminal' : 'none'
        )
      }
      const stopped = db.settleWorkerStop(dispatchId)
      runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
      return {
        dispatchId: dispatchId,
        state: stopped.state,
        alreadySettled: false,
        processAction: 'closed_agent_terminal'
      }
    }
    const closed = await runtime
      .closeTerminal(handle)
      .then((close) => ({ close }) as const)
      .catch(
        (error: unknown) =>
          ({ error: error instanceof Error ? error.message : String(error) }) as const
      )
    // The process exit can land mid-close and settle the stop from the exit path; that exit
    // is this stop's proof of success, so do not re-settle it or report it as unknown.
    if (db.getWorkerDispatch(dispatchId)?.state !== 'stopped') {
      if ('error' in closed) {
        return unknownReceipt(
          dispatchId,
          db.markWorkerStopUnknown(dispatchId, closed.error),
          'unknown'
        )
      }
      if (!closed.close.ptyKilled) {
        // The tab is retired, but the agent process was never confirmed stopped —
        // settling here is the false success this receipt exists to prevent.
        return unknownReceipt(
          dispatchId,
          db.markWorkerStopUnknown(dispatchId, describeUnconfirmedAgentStop(closed.close)),
          'closed_agent_terminal'
        )
      }
      db.settleWorkerStop(dispatchId)
    }
    runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
    return {
      dispatchId: dispatchId,
      state: db.getWorkerDispatch(dispatchId)?.state ?? 'stopped',
      alreadySettled: false,
      processAction: 'closed_agent_terminal',
      ...('close' in closed ? { close: closed.close } : {})
    }
  })
}

const activeStopByRuntime = new WeakMap<OrcaRuntimeService, Map<string, Promise<unknown>>>()

/** Two callers stopping one Dispatch: coalesced so only one of them closes the terminal. Both are
 *  in this runtime and so carry one epoch, which `beginWorkerStop` refuses a second time anyway;
 *  the epoch it does accept belongs to a row a dead runtime stranded, and no caller here holds one. */
export function dedupeWorkerStop(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  stop: () => Promise<unknown>
): Promise<unknown> {
  let active = activeStopByRuntime.get(runtime)
  if (!active) {
    active = new Map()
    activeStopByRuntime.set(runtime, active)
  }
  const inFlight = active.get(dispatchId)
  if (inFlight) {
    return inFlight
  }
  const started: Promise<unknown> = stop().finally(() => {
    if (active.get(dispatchId) === started) {
      active.delete(dispatchId)
    }
  })
  active.set(dispatchId, started)
  return started
}

export function settledReceipt(dispatchId: string, state: string) {
  return { dispatchId, state, alreadySettled: true, processAction: 'none' }
}

function contextOnlyStopWarning(result: {
  state: string
  alreadySettled: boolean
  releasedCurrentTask: boolean
}): string {
  if (result.alreadySettled) {
    return `Dispatch was already ${result.state}; no terminal process changed.`
  }
  return result.releasedCurrentTask
    ? 'The assignment was stopped without closing its unsupervised terminal process.'
    : 'The superseded assignment was stopped without changing the current Task or terminal process.'
}

export function unknownReceipt(
  dispatchId: string,
  worker: { state: string; last_error: string | null },
  processAction: string
) {
  return {
    dispatchId,
    state: worker.state,
    alreadySettled: false,
    processAction,
    lastError: worker.last_error
  }
}
