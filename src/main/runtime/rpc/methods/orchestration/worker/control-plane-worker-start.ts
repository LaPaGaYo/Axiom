import type { LocalWorkerStartInput } from './local-worker-start-input'
import type { WorkerEffect } from './worker-topology'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { WorkerStartModeReceipt } from '../../orchestration-worker-start-mode'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { DispatchCreator } from '../../../../orchestration/db/dispatch-depth'
import type { OrchestrationCallerIdentity } from '../../../../orchestration/orchestration-caller-identity'
import type { PreambleParams } from '../../../../orchestration/preamble'
import path from 'node:path'
import { quotePosixShell } from '../../../../../../shared/shell-argument-quoting'

// Why: D14 trusts these service-only inputs from the in-process Control Plane, never RPC params.
export type ControlPlaneWorkerStart = {
  dispatchCreator?: DispatchCreator
  worktreeId?: string
  branchNameOverride?: string
  preambleBuilder?: (params: PreambleParams) => string
  dispatchMaxDepth?: number
  callerIdentity?: OrchestrationCallerIdentity
  headless?: {
    prepare: (dispatchId: string) => Promise<{ command: string; env: Record<string, string> }>
  }
}

/** Like the setup completion wrapper, but the PTY must survive the child's exit until release. */
export function buildHeadlessTerminalCommand(input: {
  argv: string[]
  env: Record<string, string>
  stdinPath: string
  attemptDir: string
}) {
  const exitPath = path.join(input.attemptDir, 'exit-code')
  const operands = [
    ...Object.entries(input.env).map(([name, value]) => `${name}=${value}`),
    ...input.argv
  ]
  const script = [
    `/usr/bin/env ${operands.map(quotePosixShell).join(' ')} < ${quotePosixShell(input.stdinPath)} | tee ${quotePosixShell(path.join(input.attemptDir, 'events.jsonl'))}`,
    'axiom_worker_exit=${PIPESTATUS[0]}',
    `printf '%s\\n' "$axiom_worker_exit" > ${quotePosixShell(`${exitPath}.tmp`)}`,
    `mv ${quotePosixShell(`${exitPath}.tmp`)} ${quotePosixShell(exitPath)}`,
    'while :; do sleep 3600; done'
  ].join('; ')
  return { command: `bash --noprofile --norc -c ${quotePosixShell(script)}`, env: input.env }
}

export function controlPlaneHeadlessMode(
  args: LocalWorkerStartInput
): WorkerStartModeReceipt | undefined {
  const worktree = args.params.worktree ?? 'current'
  if (args.controlPlane?.worktreeId !== undefined && worktree !== 'current') {
    throw new OrchestrationError(
      'invalid_argument',
      'controlPlane.worktreeId requires current worktree placement.'
    )
  }
  if (!args.controlPlane?.headless) {
    return undefined
  }
  if (
    args.params.terminal ||
    worktree !== 'current' ||
    !['darwin', 'linux'].includes(process.platform)
  ) {
    throw new OrchestrationError(
      'invalid_argument',
      'Headless launch requires a new local POSIX terminal in the current worktree.'
    )
  }
  return {
    mode: 'terminal',
    preferred: 'terminal',
    reason: 'requested',
    detail: 'Control Plane headless Worker'
  }
}

export function markHeadlessWorkerReady(
  db: OrchestrationDb,
  taskId: string,
  dispatchId: string,
  effects: WorkerEffect[],
  mode: WorkerStartModeReceipt
) {
  const worker = db.markWorkerDispatchReady(dispatchId, effects)
  return {
    taskId,
    dispatchId,
    state: worker.state,
    stage: worker.stage,
    mode,
    effects,
    residualResources: []
  }
}
