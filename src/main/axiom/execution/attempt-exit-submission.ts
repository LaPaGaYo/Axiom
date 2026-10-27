import { z } from 'zod'
import { recordClaudeLaunchObservation } from './claude-worker-combination'
import { scheduleFailedWorkerRelease } from './attempt-worker-release'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { WorkerDispatchRow } from '../../runtime/orchestration/types'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { gitExecFileAsync } from '../../git/runner'
import { getMainE2EConfig } from '../../e2e-config'
import { getAxiomControlPlane } from '../control-plane'
import { redactContext } from '../context-builder/redaction'
import { resolveHostAttempt } from './attempt-authority'
import { serializeAttemptSubmission, settleSubmission } from './attempt-submission'
import { settleAttemptWithoutSubmission } from './attempt-settlement'
import {
  parseHeadlessWorkerEvents,
  parseHeadlessReport,
  headlessFailureKind
} from './headless-worker-events'
import {
  headlessAttemptDirectory,
  HeadlessLaunchSchema,
  readHeadlessFile,
  ingestHeadlessArtifacts,
  persistClaudeLastMessage
} from './headless-attempt-files'

export function isHeadlessAttempt(
  worker: Pick<WorkerDispatchRow, 'start_options'> | undefined
): boolean {
  try {
    return z
      .object({ channel: z.literal('headless') })
      .safeParse(JSON.parse(worker?.start_options ?? '{}')).success
  } catch {
    return false
  }
}

export function submitExitedAttempt(runtime: OrcaRuntimeService, attemptId: string) {
  return serializeAttemptSubmission(runtime.getOrchestrationDb(), attemptId, () =>
    submitExit(runtime, attemptId)
  )
}

async function submitExit(runtime: OrcaRuntimeService, attemptId: string) {
  const db = runtime.getOrchestrationDb()
  const { store, missions, artifacts } = getAxiomControlPlane(runtime)
  const worker = db.getWorkerDispatch(attemptId)
  if (!isHeadlessAttempt(worker) || store.getSubmissionByDispatch(attemptId)) {
    return 'unchanged'
  }
  let authority: ReturnType<typeof resolveHostAttempt>
  try {
    authority = resolveHostAttempt(db, store, attemptId)
  } catch {
    return 'unchanged'
  }
  const directory = headlessAttemptDirectory(attemptId)
  const launch = HeadlessLaunchSchema.parse(
    JSON.parse((await readHeadlessFile(directory, 'launch.json')) ?? '{}')
  )
  // Scratch files are Worker-writable. Provider authority comes from the bound spec or
  // the kernel's durable start options (legacy Codex rows may omit agent).
  const provider =
    store.getAgentSpec(authority.binding.agentSpecId)?.spec.provider ??
    z
      .object({ agent: z.enum(['codex', 'claude']).default('codex') })
      .parse(JSON.parse(worker?.start_options ?? '{}')).agent
  const claudeEvents =
    provider === 'claude'
      ? parseHeadlessWorkerEvents(
          (await readHeadlessFile(directory, 'events.jsonl')) ?? '',
          'claude'
        )
      : undefined
  if (claudeEvents?.claudeInit) {
    recordClaudeLaunchObservation(store, authority.mission.id, attemptId, claudeEvents.claudeInit)
  }
  const exit = await readHeadlessFile(directory, 'exit-code')
  if (exit === undefined || !/^-?\d+\s*$/.test(exit)) {
    return 'pending'
  }
  // Deterministic restart seam: hold only the host submission, after durable process-exit evidence.
  if (getMainE2EConfig().enabled && process.env.AXIOM_E2E_HOLD_EXIT_SUBMISSION === '1') {
    return 'pending'
  }
  const exitCode = Number(exit.trim())
  const events =
    claudeEvents ??
    parseHeadlessWorkerEvents((await readHeadlessFile(directory, 'events.jsonl')) ?? '')
  await persistClaudeLastMessage(directory, provider, events)
  // A Claude report must originate in its terminal result, never a Worker-written file.
  const lastMessage =
    provider === 'claude'
      ? (events.lastMessage ?? '')
      : ((await readHeadlessFile(directory, 'last-message.md')) ?? '')
  const { providerSessionId, usage } = events
  const eventAudit = {
    ...(providerSessionId ? { providerSessionId } : {}),
    ...(usage ? { usage } : {}),
    ...(events.total_cost_usd !== undefined ? { total_cost_usd: events.total_cost_usd } : {}),
    ...(events.permission_denials ? { permission_denials: events.permission_denials } : {}),
    ...(events.modelUsage ? { modelUsage: events.modelUsage } : {}),
    ...(events.num_turns !== undefined ? { num_turns: events.num_turns } : {})
  }
  let reportError: string | undefined
  let report: ReturnType<typeof parseHeadlessReport> | undefined
  let artifactIds: string[] = []
  const worktree = splitWorktreeIdForFilesystem(launch.worktreeId)?.worktreePath
  if (
    !worktree ||
    launch.worktreeId !== worker?.worktree_id ||
    launch.branch !== authority.binding.branch
  ) {
    throw new Error('Headless launch binding mismatch')
  }
  const failedResult = provider === 'claude' && events.turnFailed
  if (exitCode === 0 && !failedResult) {
    try {
      report = parseHeadlessReport(redactContext(lastMessage).content)
      artifactIds = await ingestHeadlessArtifacts({
        artifacts,
        worktree,
        missionId: authority.mission.id,
        taskId: authority.task.taskId,
        attemptId,
        entries: report.artifacts
      })
    } catch (error) {
      reportError = redactContext(error instanceof Error ? error.message : 'Invalid report').content
    }
  }
  if (exitCode !== 0 || failedResult || !report || reportError) {
    const kind = headlessFailureKind(events)
    store.transaction('headless_exit_failure', () => {
      resolveHostAttempt(db, store, attemptId)
      db.failDispatch(attemptId, 'Headless Worker exited without a valid Submission', {
        workerProcessExited: true,
        terminationReason: 'process_exited'
      })
      store.appendAuditEvent({
        missionId: authority.mission.id,
        actor: 'AttemptSettlement',
        event: 'attempt.failed',
        objectKind: 'attempt',
        objectId: attemptId,
        before: null,
        after: {
          taskId: authority.task.taskId,
          reason: 'process_exited',
          evidence: 'exit_code',
          exitCode,
          settlement: { kind },
          lastError: redactContext(events.lastError ?? '').content.slice(-2000),
          ...(events.lastErrorEvent
            ? {
                lastErrorEvent: {
                  type: events.lastErrorEvent.type,
                  message: redactContext(events.lastErrorEvent.message).content.slice(-2000)
                }
              }
            : {}),
          lastMessageExcerpt: redactContext(lastMessage).content.slice(-2000),
          ...(reportError ? { reportError } : {}),
          ...eventAudit
        }
      })
      settleAttemptWithoutSubmission(
        { store, missions },
        {
          ...authority.binding,
          dispatchId: attemptId,
          reason: kind === 'interrupted' ? 'interrupted' : 'attempt_failed',
          actor: 'AttemptSettlement'
        }
      )
    })
    scheduleFailedWorkerRelease(runtime, { missionId: authority.mission.id, attemptId })
    return kind
  }
  const reportArtifact = await artifacts.put({
    missionId: authority.mission.id,
    kind: 'worker_report',
    mediaType: 'text/markdown',
    content: Buffer.from(redactContext(lastMessage).content),
    createdBy: `attempt:${attemptId}`,
    related: [authority.task.taskId, attemptId]
  })
  const submissionReport = {
    ...report,
    artifacts: [reportArtifact.id, ...artifactIds],
    filesChanged: []
  }
  await settleSubmission(
    { attemptId, report: submissionReport },
    { runtime },
    {
      headless: true,
      resolveAuthority: () => resolveHostAttempt(db, store, attemptId),
      audit: { exitCode, ...eventAudit },
      finalizeReport: async (snapshot) => ({
        ...submissionReport,
        filesChanged: (
          await gitExecFileAsync(
            [
              'diff',
              '--name-only',
              '-z',
              '--no-renames',
              launch.baselineSha,
              snapshot.commitSha,
              '--'
            ],
            { cwd: worktree }
          )
        ).stdout
          .split('\0')
          .filter(Boolean)
      })
    }
  )
  return 'submitted'
}

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
