import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import type { AdmittedAttempt } from '../scheduler/scheduler'
import type { AttemptLauncherDependencies } from './attempt-launch-contract'
import type { AttemptBaseline } from './attempt-baseline'
import { attemptBaselineRef } from './attempt-fix-launch'
import type { ContinuationReaders } from './in-place-continuation'
import { headlessAttemptDirectory } from './headless-attempt-files'
import { readHeadlessLaunchRecord, resolveHeadlessLaunchRecord } from './headless-launch-record'
import { firstThreadStarted, readAttemptSession } from './in-place-session'
import { resolveHeadlessWorkerBinary } from './headless-worker-command'
import { harnessVersion } from './worker-launch-combination'
import { readAttemptAccount } from './attempt-account'
import { findCodexSessionRecord } from './codex-session-record'
import { inspectContinuationWorktree } from './in-place-worktree'

export const CONTINUATION_EVENT_BYTES = 64 * 1024

export async function readContinuationThread(directory: string): Promise<string | undefined> {
  try {
    const file = await open(
      path.join(directory, 'events.jsonl'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const info = await file.stat()
      if (!info.isFile()) {
        throw new Error('continuation_events_unreadable')
      }
      const buffer = Buffer.alloc(Math.min(info.size, CONTINUATION_EVENT_BYTES))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      return firstThreadStarted(
        info.size > bytesRead ? text.slice(0, text.lastIndexOf('\n') + 1) : text
      ).id
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export function continuationReaders(input: {
  deps: AttemptLauncherDependencies
  attempt: AdmittedAttempt
  spec: AgentSpec
  baseline: AttemptBaseline
}): ContinuationReaders {
  const { deps, attempt, spec, baseline } = input
  const { store, db } = deps
  const previous = () => store.getAttemptBinding(attempt.taskId, attempt.seq - 1)
  const audit = (event: string) =>
    store
      .listAuditEvents({ missionId: attempt.missionId })
      .findLast(
        (row) =>
          row.objectKind === 'attempt' &&
          row.objectId === previous()?.dispatchId &&
          row.event === event
      )
  return {
    previous: () => {
      const binding = previous()
      if (!binding?.dispatchId) {
        return undefined
      }
      return {
        seq: binding.seq,
        branch: binding.branch,
        dispatchId: binding.dispatchId,
        failure: audit('attempt.failed')?.after,
        preservation: audit('attempt.preserved')?.after,
        stopped: !!audit('attempt.stopped'),
        submitted: !!store.getSubmissionByDispatch(binding.dispatchId),
        session: readAttemptSession(store, attempt.missionId, binding.dispatchId)
      }
    },
    agents: () => ({
      current: spec,
      previous: store.getAgentSpec(previous()?.agentSpecId ?? '')?.spec
    }),
    version: async () =>
      spec.provider === 'codex'
        ? harnessVersion(
            resolveHeadlessWorkerBinary(
              spec.provider,
              deps.runtime.requireStore().getSettings().agentCmdOverrides?.codex
            )
          )
        : null,
    accounts: () => {
      if (!deps.runtime.resolveCodexHomeForWorkerLaunch) {
        throw new Error('continuation_home_unreadable')
      }
      return {
        current: deps.runtime.resolveCodexHomeForWorkerLaunch(),
        previous: readAttemptAccount(
          store,
          attempt.missionId,
          previous()?.dispatchId ?? '',
          spec.provider
        )?.home
      }
    },
    manifests: () => ({
      current: store.getContextPackage(attempt.contextPackageId)?.manifest,
      previous: store.getContextPackage(previous()?.contextPackageId ?? '')?.manifest
    }),
    thread: () => readContinuationThread(headlessAttemptDirectory(previous()?.dispatchId ?? '')),
    originStartedAt: (seq) => {
      const id = store.getAttemptBinding(attempt.taskId, seq)?.dispatchId
      return Date.parse(
        exposeUtcTimestamp(id ? (db.getWorkerDispatch(id)?.created_at ?? null) : null) ?? ''
      )
    },
    recordExists: async (accountHome, threadId, startedAt) =>
      !!(await findCodexSessionRecord({
        accountHome,
        threadId,
        startedAt,
        now: deps.now ? Date.parse(deps.now()) : Date.now(),
        includeArchived: true
      })),
    worktree: async (predecessor, preservation) => {
      const directory = headlessAttemptDirectory(predecessor.dispatchId)
      let launch: Awaited<ReturnType<typeof readHeadlessLaunchRecord>>
      try {
        const info = await lstat(path.join(directory, 'launch.json'))
        if (!info.isFile() || info.size > CONTINUATION_EVENT_BYTES) {
          return undefined
        }
        launch = await readHeadlessLaunchRecord(directory)
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          error instanceof z.ZodError ||
          (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        ) {
          return undefined
        }
        throw error
      }
      let resolved: ReturnType<typeof resolveHeadlessLaunchRecord>
      const worker = db.getWorkerDispatch(predecessor.dispatchId)
      try {
        resolved = resolveHeadlessLaunchRecord(launch, worker, predecessor)
      } catch {
        return undefined
      }
      if (resolved.baselineSha !== preservation.baselineSha) {
        return undefined
      }
      return inspectContinuationWorktree({
        worktree: { id: launch.worktreeId, path: resolved.worktreePath },
        previousBranch: predecessor.branch,
        branch: attempt.branch,
        baselineRef: attemptBaselineRef(baseline, attempt.missionId),
        baselineSha: preservation.baselineSha,
        snapshot:
          preservation.result.status === 'preserved' ? preservation.result.snapshot : undefined
      })
    }
  }
}
