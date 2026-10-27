import { tuiWorkerCombination } from './worker-launch-combination'
import type { CodexWorkerLaunchHome } from '../../codex/codex-worker-launch-home'
import { settleAttemptWithoutSubmission } from './attempt-settlement'
import { z } from 'zod'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import type { startLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-start'
import { assertWorkerStartTaskSpecWithinPromptBudget } from '../../runtime/rpc/methods/orchestration/worker/worker-start-prompt-budget'
import { plannerAwareStartMode } from './planner-launch-mode'
import { WorkerStartParams } from '../../../shared/rpc-contract/orchestration-worker-start-params'
import {
  isWorkerStartTimeoutWithinTimerLimit,
  resolveWorkerStartReadinessTimeoutMs
} from '../../../shared/orchestration-timing-budgets'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { AdmittedAttempt, AttemptLaunch } from '../scheduler/scheduler'
import { redactContext } from '../context-builder/redaction'
import { missionCaller } from './mission-caller'
import { resolveAttemptBaseline } from './attempt-baseline'
import { attemptBaselineAudit, prepareWorkerFixLaunch } from './attempt-fix-launch'
import { hasHeadlessWorkerBuilder } from './headless-worker-command'
import { createHeadlessWorkerLaunch } from './headless-worker-launch'
import { watchHeadlessAttempt } from './attempt-exit-submission'
import { createAttemptLaunchAudit } from './attempt-launch-audit'
import { claudePlannerLaunchPolicy } from './planner-claude-launch'

type LauncherRuntime = Pick<OrcaRuntimeService, 'createManagedWorktree' | 'requireStore'> &
  Partial<Pick<OrcaRuntimeService, 'resolveClaudeHomeForWorkerLaunch'>>
export type AttemptWorkerStartArgs = Omit<Parameters<typeof startLocalWorker>[0], 'runtime'> & {
  runtime: LauncherRuntime
}
export type AttemptLauncherDependencies = {
  db: OrchestrationDb
  store: AxiomStore
  missions: MissionController
  artifacts: ArtifactStore
  now?: () => string
  codexWorkerHome?: () => Promise<CodexWorkerLaunchHome>
} & (
  | { runtime: OrcaRuntimeService; startWorker?: undefined }
  | { runtime: LauncherRuntime; startWorker: (args: AttemptWorkerStartArgs) => Promise<unknown> }
)
const Receipt = z.object({
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  state: z.enum(['ready', 'failed', 'outcome_unknown'])
})

export function createAttemptLauncher(
  deps: AttemptLauncherDependencies,
  planner?: { goalRevisionId: string; baseBranch: string; runSeq: number }
): AttemptLaunch {
  const { db, store, missions, artifacts } = deps
  const audit = createAttemptLaunchAudit(deps, planner)
  const fail = (attempt: AdmittedAttempt) =>
    planner
      ? undefined
      : settleAttemptWithoutSubmission(
          { store, missions },
          {
            taskId: attempt.taskId,
            seq: attempt.seq,
            dispatchId: store.getAttemptBinding(attempt.taskId, attempt.seq)?.dispatchId ?? null,
            reason: 'launch_failed',
            actor: 'Scheduler'
          }
        )
  return async (attempt) => {
    let workerAudit: Record<string, AuditEvent['after']> = {}
    try {
      const binding = store.getAttemptBinding(attempt.taskId, attempt.seq)
      if (
        !binding ||
        binding.dispatchId !== null ||
        (!planner && store.getTaskStage(attempt.taskId)?.stage !== 'RUNNING')
      ) {
        return
      }
      const mission = missions.getMission(attempt.missionId)
      const run = db.getRun(mission.runId)
      let existingTask = db.getTask(attempt.taskId)
      const spec = store.getAgentSpec(attempt.agentSpecId)?.spec
      const context = store.getContextPackage(attempt.contextPackageId)
      if (
        !run ||
        !existingTask ||
        existingTask.run_id !== run.id ||
        !spec ||
        spec.missionId !== attempt.missionId ||
        (planner
          ? spec.role !== 'planner' ||
            spec.goalRevisionId !== planner.goalRevisionId ||
            mission.status !== 'ANALYZING' ||
            mission.activeGoalRevisionId !== planner.goalRevisionId
          : !context ||
            spec.role !== 'worker' ||
            spec.taskId !== attempt.taskId ||
            spec.contextPackageId !== context.id ||
            context.taskId !== attempt.taskId ||
            context.missionId !== attempt.missionId)
      ) {
        throw new OrchestrationError(
          'invalid_argument',
          'Invalid admitted Attempt contracts or Run binding.'
        )
      }
      const renderId = planner ? attempt.contextPackageId : context?.mandatoryRefs[1]
      if (!renderId) {
        throw new OrchestrationError('invalid_argument', 'Missing ContextPackage render.')
      }
      const render = (await artifacts.read(renderId)).content.toString('utf8')
      await assertWorkerStartTaskSpecWithinPromptBudget(existingTask.spec)
      const timeoutMs = resolveWorkerStartReadinessTimeoutMs(undefined)
      if (!isWorkerStartTimeoutWithinTimerLimit(timeoutMs)) {
        throw new OrchestrationError('invalid_argument', 'Invalid worker readiness timeout.')
      }
      const baseline = planner ? undefined : resolveAttemptBaseline(store, attempt)
      if (baseline) {
        workerAudit = { baseline: attemptBaselineAudit(baseline) }
      }
      const created = await deps.runtime.createManagedWorktree({
        repoSelector: `id:${mission.repoId}`,
        name: planner
          ? `planner-${attempt.missionId}-${planner.runSeq}`
          : `attempt-${attempt.taskId}-${attempt.seq}`,
        baseBranch:
          planner?.baseBranch ??
          (baseline?.kind === 'candidate'
            ? baseline.candidate.commitSha
            : `axiom/integration/${attempt.missionId}`),
        branchNameOverride: attempt.branch,
        runHooks: false,
        setupDecision: 'run',
        awaitTerminalProvisioning: true,
        observeSetupCompletion: true,
        createdWithAgent: spec.provider,
        activate: false,
        lineage: {
          noParent: true,
          orchestrationContext: { orchestrationRunId: run.id, taskId: attempt.taskId }
        }
      })
      const worktreeId = created.worktree.id
      const headless = !planner && hasHeadlessWorkerBuilder(spec.provider)
      if (!planner) {
        workerAudit = {
          ...workerAudit,
          channel: headless ? 'headless' : 'tui',
          posture: headless ? 'headless-sandboxed' : 'tui-bypass',
          ...(!headless ? { combination: tuiWorkerCombination(spec) } : {})
        }
      }
      const caller = missionCaller(mission.coordinatorOrcaSessionId, worktreeId)
      if (baseline) {
        const prepared = await prepareWorkerFixLaunch(
          db,
          store,
          attempt,
          baseline,
          created.worktree
        )
        existingTask = prepared.existingTask
        if (prepared.orcaTaskReopened) {
          workerAudit.orcaTaskReopened = true
        }
      }
      const params = WorkerStartParams.parse({
        from: caller.address,
        task: attempt.taskId,
        worktree: 'current',
        agent: spec.provider,
        model: spec.model === 'policy-default' ? undefined : spec.model,
        effort: spec.model === 'policy-default' ? undefined : spec.reasoning.effort,
        timeoutMs,
        retryOf: ['failed', 'blocked'].includes(existingTask.status)
          ? db.getDispatchContext(attempt.taskId)?.id
          : undefined
      })
      const args: Omit<AttemptWorkerStartArgs, 'runtime'> = {
        params,
        db,
        run,
        coordinator: caller,
        callerSession: caller,
        existingTask,
        mode: plannerAwareStartMode(deps.runtime, params, Boolean(planner)),
        controlPlane: {
          dispatchCreator: { kind: 'system' },
          worktreeId,
          dispatchMaxDepth: 1,
          callerIdentity: caller,
          ...(planner ? claudePlannerLaunchPolicy(deps, spec) : {}),
          ...(headless
            ? {
                headless: createHeadlessWorkerLaunch({
                  deps,
                  attempt,
                  spec,
                  worktree: created.worktree,
                  render,
                  audit: workerAudit,
                  onPrepared: (id, after) => audit(attempt, 'attempt.headless_prepared', id, after),
                  onMismatch: (id, reasons) =>
                    audit(attempt, 'attempt.launch_mismatch', id, { reasons })
                })
              }
            : {}),
          preambleBuilder: (p) => {
            // The provider can propose before startLocalWorker returns its readiness receipt.
            // Bind before delivering its Attempt preamble.
            if (planner) {
              const current = missions.getMission(attempt.missionId)
              if (
                current.status !== 'ANALYZING' ||
                current.activeGoalRevisionId !== planner.goalRevisionId
              ) {
                throw new OrchestrationError(
                  'invalid_argument',
                  'Planner launch is no longer current.'
                )
              }
              if (
                !store.bindAttemptDispatch(attempt.taskId, attempt.seq, p.dispatchId) &&
                store.getAttemptBinding(attempt.taskId, attempt.seq)?.dispatchId !== p.dispatchId
              ) {
                throw new OrchestrationError(
                  'invalid_argument',
                  'Planner dispatch binding changed.'
                )
              }
            }
            return render.replaceAll('{{attemptId}}', p.dispatchId)
          }
        }
      }
      // Lazy import keeps the fake-kernel contract independent of Electron and host services.
      const result = deps.startWorker
        ? await deps.startWorker({ ...args, runtime: deps.runtime })
        : await (
            await import('../../runtime/rpc/methods/orchestration/worker/local-worker-start')
          ).startLocalWorker({ ...args, runtime: deps.runtime })
      const receipt = Receipt.parse(result)
      if (receipt.taskId !== attempt.taskId) {
        throw new OrchestrationError('invalid_argument', 'Worker receipt Task mismatch.')
      }
      if (
        !store.bindAttemptDispatch(attempt.taskId, attempt.seq, receipt.dispatchId) &&
        store.getAttemptBinding(attempt.taskId, attempt.seq)?.dispatchId !== receipt.dispatchId
      ) {
        return
      }
      const event =
        receipt.state === 'ready'
          ? 'attempt.started'
          : receipt.state === 'failed'
            ? 'attempt.launch_failed'
            : 'attempt.start_unknown'
      store.transaction('launch_settlement', () => {
        audit(attempt, event, receipt.dispatchId, {
          taskId: attempt.taskId,
          seq: attempt.seq,
          branch: attempt.branch,
          worktreeId,
          provider: spec.provider,
          ...workerAudit
        })
        if (receipt.state === 'failed') {
          fail(attempt)
        }
      })
      if (headless && receipt.state === 'ready' && !deps.startWorker) {
        watchHeadlessAttempt(deps.runtime, receipt.dispatchId)
      }
    } catch (error) {
      try {
        // Once bound, an unexpected persistence failure belongs to recovery, never a fresh launch.
        if (store.getAttemptBinding(attempt.taskId, attempt.seq)?.dispatchId) {
          return
        }
        const message = redactContext(
          error instanceof Error ? error.message : 'Attempt launch failed'
        ).content.replace(/dcap_[A-Za-z0-9_-]+/g, '[REDACTED]')
        store.transaction('launch_failure', () => {
          audit(attempt, 'attempt.launch_failed', null, { message, ...workerAudit })
          fail(attempt)
        })
      } catch {
        // Durable admission survives even a database failure; M2-08 reconciles LAUNCH_PENDING.
        console.warn('[axiom] Attempt launch settlement unavailable', {
          taskId: attempt.taskId,
          seq: attempt.seq
        })
      }
    }
  }
}
