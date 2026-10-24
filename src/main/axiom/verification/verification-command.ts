import childProcess, { type ChildProcess } from 'node:child_process'
import { killLocalPrecheckProcessTree } from '../../automations/precheck-runner'
import { VerificationOutput } from './verification-output'
import type { CheckOutcome } from './verification-verdict'

export type CommandResult = CheckOutcome & {
  exitCode: number | null
  signal: string | null
  durationMs: number
  startedAt: string
  finishedAt: string
  stdout: ReturnType<VerificationOutput['snapshot']>
  stderr: ReturnType<VerificationOutput['snapshot']>
}

export function skippedVerificationCommand(reason: string): CommandResult {
  const now = new Date().toISOString()
  return {
    result: 'skipped',
    reason,
    exitCode: null,
    signal: null,
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
    stdout: new VerificationOutput().snapshot(),
    stderr: new VerificationOutput().snapshot()
  }
}

export async function runVerificationCommand(input: {
  command: string
  cwd: string
  deadline: number
  signal?: AbortSignal
}): Promise<CommandResult> {
  if (Date.now() >= input.deadline) {
    return skippedVerificationCommand('time_budget_exhausted')
  }
  if (input.signal?.aborted) {
    return skippedVerificationCommand('shutdown')
  }
  const started = Date.now()
  const stdout = new VerificationOutput()
  const stderr = new VerificationOutput()
  let timedOut = false
  let stopped = false
  let spawnCode: string | undefined
  let killBarrier: Promise<void> | undefined
  let child: ChildProcess
  const result = (exitCode: number | null, signal: string | null): CommandResult => {
    let outcome: CheckOutcome
    if (timedOut) {
      outcome = { result: 'environmental', reason: 'timeout' }
    } else if (stopped || signal) {
      outcome = { result: 'environmental', reason: 'killed' }
    } else if (spawnCode || exitCode === 127 || exitCode === 9009) {
      outcome = {
        result: 'environmental',
        reason:
          !spawnCode || ['ENOENT', 'EACCES'].includes(spawnCode) ? 'tool_missing' : 'spawn_failed'
      }
    } else {
      outcome = { result: exitCode === 0 ? 'pass' : 'fail' }
    }
    return {
      ...outcome,
      exitCode,
      signal,
      durationMs: Date.now() - started,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: stdout.snapshot(),
      stderr: stderr.snapshot()
    }
  }
  try {
    // D65 explicitly uses automation precheck's shell-command semantics and tree-kill helper.
    child = childProcess.spawn(input.command, {
      shell: true,
      cwd: input.cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      windowsHide: true
    })
  } catch (error) {
    spawnCode = error instanceof Error && 'code' in error ? String(error.code) : 'spawn_failed'
    return result(null, null)
  }
  return new Promise((resolve) => {
    const terminate = (timeout: boolean) => {
      if (stopped) {
        return
      }
      stopped = true
      timedOut = timeout
      const forceKill = killLocalPrecheckProcessTree(child)
      // A shell can close its pipes before a TERM-ignoring descendant exits. Preserve the
      // helper's delayed SIGKILL and wait for it before recovery may remove this worktree.
      if (forceKill) {
        killBarrier = new Promise((done) => setTimeout(done, 2100))
      }
    }
    const abort = () => terminate(false)
    const timeout = setTimeout(() => terminate(true), Math.max(1, input.deadline - Date.now()))
    input.signal?.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk))
    child.on('error', (error) => {
      spawnCode = 'code' in error ? String(error.code) : 'spawn_failed'
    })
    child.on('close', async (code, signal) => {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abort)
      await killBarrier
      resolve(result(code, signal))
    })
    if (input.signal?.aborted) {
      abort()
    }
  })
}
