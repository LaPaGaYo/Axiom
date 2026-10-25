import { controlPlaneHeadlessMode, markHeadlessWorkerReady } from './control-plane-worker-start'
import type { LocalWorkerStartInput } from './local-worker-start-input'
import { probeWorkerOpenCodeModelLaunchSupport } from './worker-opencode-model-preflight'
import { resolveWorkerConfiguredAgentParams } from './worker-configured-agent-preflight'
import { waitForWorkerAgentReady } from '../../../../launched-agent-composer-readiness'
import { describeTerminalWaitBlockedReason } from '../../../../../../shared/terminal-wait-blocked-reason-legacy-alias'
import { resolveDispatchCreator } from '../runs/dispatch-creator'
import { resolveDispatchCallerWorktreeId } from '../../orchestration-caller-workspace'
import { resolveWorkerStartModeOnHost } from '../../orchestration-worker-start-mode'
import { EXISTING_WORKTREE_SETUP, placeWorkerAgent } from './worker-start-agent-placement'
import { awaitStructuredWorkerSetupGate } from './worker-start-structured-setup-gate'
import { assertOrchestrationWorktreeCreationSupported } from './folder-worktree-placement'
import {
  persistGatedSetupSpawnFailure,
  persistWorkerReadinessStage,
  persistWorkerSetupWaitOutcome
} from './worker-setup-gate'
import { failWorkerStartWithReceipt } from './worker-start-receipt'
import { parseTaskDeps } from './task-deps-argument'
import { assertExplicitWorkerUsable } from './explicit-worker-terminal-validation'
import { resolveDispatchAssigneeParty } from '../../../../orchestration/orchestration-party'
import { CHAT_WORKER_AUTHORITY, chatAssigneeOf, chatWorkerMode } from '../chat-assignee-admission'
import { recordCreatedWorkerTerminalCustody } from './created-worker-terminal-custody'
import { tearDownFailedWorkerStart } from './failed-worker-start-teardown'
import { releaseRetriedWorkerTerminal } from './retried-worker-terminal-release'
import { requireWorkerAuthority, type WorkerEffect } from './worker-topology'
import { prepareLocalWorkerStart } from './worker-start-validation'
import { deliverAndSettleWorkerStartReadiness } from './worker-start-readiness-settlement'

export async function startLocalWorker(args: LocalWorkerStartInput): Promise<unknown> {
  const { runtime, db, run, coordinator, callerSession, existingTask, orchestrationMutation } = args
  // `--terminal` names a party: a chat by its `/clear` root address, as its Dispatch does.
  const terminal = args.params.terminal && resolveDispatchAssigneeParty(args.params.terminal, db)
  const params = terminal ? { ...args.params, terminal: terminal.address } : args.params
  const chat = terminal ? chatAssigneeOf(terminal) : null
  const requestedWorktree = params.worktree ?? 'current'
  const headless = args.controlPlane?.headless
  const headlessMode = controlPlaneHeadlessMode(args)
  const createsWorktree = requestedWorktree === 'new-child' || requestedWorktree === 'new-top-level'
  const launchParams = await resolveWorkerConfiguredAgentParams(runtime, params, async () => {
    const callerWorkspaceId = await resolveDispatchCallerWorktreeId(
      runtime,
      params.from,
      callerSession
    )
    const parent = createsWorktree
      ? await runtime.showManagedWorktree(`id:${callerWorkspaceId}`)
      : undefined
    return createsWorktree
      ? { repo: params.repo ?? parent?.repoId }
      : {
          worktree: requestedWorktree === 'current' ? `id:${callerWorkspaceId}` : requestedWorktree
        }
  })
  let openCodeModelLaunchSupported = false
  if (!createsWorktree && launchParams.agent === 'opencode' && launchParams.model) {
    const callerWorkspaceId = await resolveDispatchCallerWorktreeId(
      runtime,
      params.from,
      callerSession
    )
    openCodeModelLaunchSupported = await probeWorkerOpenCodeModelLaunchSupport(
      runtime,
      launchParams,
      { worktree: requestedWorktree === 'current' ? `id:${callerWorkspaceId}` : requestedWorktree }
    )
  }

  const { agent, launch } = prepareLocalWorkerStart({
    params: launchParams,
    createsWorktree,
    runtime,
    openCodeModelLaunchSupported
  })

  const coordinatorWorktreeId = await resolveDispatchCallerWorktreeId(
    runtime,
    params.from,
    callerSession
  )
  const creationWorktree = createsWorktree
    ? await runtime.showManagedWorktree(`id:${coordinatorWorktreeId}`)
    : undefined
  if (creationWorktree) {
    await assertOrchestrationWorktreeCreationSupported({
      runtime,
      repoSelector: params.repo ?? creationWorktree.repoId,
      existingPlacement: 'current or an exact existing folder workspace'
    })
  }
  let resolvedWorktree: Awaited<ReturnType<typeof placeWorkerAgent>>['worktree'] | undefined =
    creationWorktree
      ? undefined
      : requestedWorktree === 'current'
        ? await runtime.showManagedTerminalWorkspace(
            `id:${args.controlPlane?.worktreeId ?? coordinatorWorktreeId}`
          )
        : await runtime.showManagedTerminalWorkspace(requestedWorktree)
  if (terminal) {
    await assertExplicitWorkerUsable({
      runtime,
      db,
      terminal,
      from: params.from,
      coordinator,
      resolvedWorktreeId: resolvedWorktree?.id
    })
  }
  const hostMode =
    headlessMode ?? resolveWorkerStartModeOnHost(runtime, args.mode, resolvedWorktree?.id, agent)
  let mode = chatWorkerMode(await hostMode, chat)

  const startOptions = {
    ...(headless ? { channel: 'headless' } : {}),
    worktree: requestedWorktree,
    mode,
    resolvedWorktreeId: resolvedWorktree?.id ?? null,
    name: params.name ?? null,
    repo: params.repo ?? creationWorktree?.repoId ?? null,
    baseBranch: params.baseBranch ?? null,
    terminal: params.terminal ?? null,
    agent: agent ?? null,
    launch: launch.receipt,
    timeoutMs: params.timeoutMs ?? 60_000,
    setup: createsWorktree ? (params.setup ?? 'run') : 'not_applicable',
    setupSource: createsWorktree
      ? params.setup
        ? 'explicit_request'
        : 'orchestration_default'
      : 'existing_worktree'
  }
  const started = db.createStartingWorkerDispatch({
    creator:
      args.controlPlane?.dispatchCreator ??
      resolveDispatchCreator(runtime, params.from, callerSession),
    maxDepth: Math.min(
      runtime.getNestedWorkerMaxDepth(),
      args.controlPlane?.dispatchMaxDepth ?? Infinity
    ),
    requiredCreatorDispatchId: args.helperCreator?.id,
    taskId: existingTask?.id,
    taskSpec: params.spec,
    taskTitle: params.taskTitle,
    taskDeps: parseTaskDeps(params.deps),
    // A helper's Task sits under its creator's Task, so the Run's Task tree shows who started it.
    taskParentId: params.parent ?? args.helperCreator?.task_id,
    taskRunId: run.id,
    // A handle-less session creates root Tasks: Task lineage is recorded by terminal only.
    taskCreatedByTerminalHandle: coordinator?.terminalHandle ?? undefined,
    taskCreatedByPaneKey: coordinator?.paneKey ?? undefined,
    taskCreatedByProcessIncarnation: coordinator?.terminalHandle
      ? (runtime.getTerminalProcessIncarnation(coordinator.terminalHandle) ?? undefined)
      : undefined,
    taskCreatedByRunGeneration: run.consumer_generation,
    retryOf: params.retryOf,
    startOptions,
    runtimeEpoch: runtime.getRuntimeId(),
    mutationReceipt: orchestrationMutation
  })
  releaseRetriedWorkerTerminal(runtime, db, params)
  const effects: WorkerEffect[] = []
  const task = started.task
  if (resolvedWorktree) {
    effects.push(
      { kind: 'worktree', action: 'reused', id: resolvedWorktree.id },
      { kind: 'setup', action: 'not_applicable', state: 'not_applicable' }
    )
  }
  let terminalHandle = params.terminal
  let placed: Awaited<ReturnType<typeof placeWorkerAgent>> | undefined
  let failedStage = 'terminal_create'
  try {
    placed = await placeWorkerAgent({
      runtime,
      db,
      dispatchId: started.dispatch.id,
      taskId: task.id,
      params,
      branchNameOverride: args.controlPlane?.branchNameOverride,
      callerIdentity: args.controlPlane?.callerIdentity,
      requestedWorktree,
      creationWorktree,
      resolvedWorktree,
      mode,
      agent,
      launchPreferences: launch.preferences,
      headless,
      effects,
      onStage: (stage) => {
        failedStage = stage
      }
    })
    // A created worktree settles its mode only once the host can be asked about it, so the
    // receipt the caller decided is not always the one that ran.
    mode = placed.mode
    resolvedWorktree = placed.worktree
    terminalHandle = placed.terminalHandle
    const { structuredSession, setupReceipt } = placed
    const setupStage = {
      db,
      dispatchId: started.dispatch.id,
      worktreeId: resolvedWorktree.id,
      terminalHandle,
      setup: setupReceipt,
      effects
    }
    recordCreatedWorkerTerminalCustody(runtime, setupStage, !params.terminal && !structuredSession)
    if (persistGatedSetupSpawnFailure(setupStage)) {
      failedStage = 'setup_start'
      throw new Error('Setup terminal failed to start before the gated agent launch.')
    }
    persistWorkerReadinessStage(setupStage)

    failedStage = 'agent_readiness'
    // A structured worker's setup gate and its preamble's wait share one deadline: the timeout.
    const readinessDeadline = Date.now() + (params.timeoutMs ?? 60_000)
    // A structured session has no boot-to-idle gap or terminal title to read: its agent's start is
    // waited out by the preamble's send. Only the repo's wait-for-setup policy is waited on here.
    const wait = structuredSession
      ? await awaitStructuredWorkerSetupGate({
          runtime,
          setup: setupReceipt,
          effects,
          timeoutMs: Math.max(0, readinessDeadline - Date.now())
        })
      : chat || headless
        ? // A chat takes its task as a queued send whatever it is doing, so nothing is waited on.
          null
        : await waitForWorkerAgentReady(runtime, terminalHandle, {
            agent,
            reusesTerminal: Boolean(params.terminal),
            timeoutMs: params.timeoutMs ?? 60_000
          })
    if (wait) {
      persistWorkerSetupWaitOutcome({ ...setupStage, wait })
      if (!wait.satisfied) {
        if (setupReceipt.state === 'failed') {
          failedStage = 'setup_wait'
        }
        throw new Error(
          wait.blockedReason
            ? `Agent startup blocked: ${describeTerminalWaitBlockedReason(wait.blockedReason)}`
            : structuredSession
              ? `Setup did not finish before the structured worker started (${wait.status}).`
              : `Agent did not become ready (${wait.status}).`
        )
      }
    }
    // A chat has no pane or process; its Dispatch names it by its Orca session ID alone.
    const terminalAuthority = chat
      ? CHAT_WORKER_AUTHORITY
      : requireWorkerAuthority(runtime, terminalHandle)
    db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: terminalHandle,
      ...terminalAuthority,
      worktreeId: resolvedWorktree.id,
      effects,
      setupState: setupReceipt.state,
      terminalOwnership: params.terminal ? 'external' : 'created'
    })

    if (headless) {
      return markHeadlessWorkerReady(db, task.id, started.dispatch.id, effects, mode)
    }

    return await deliverAndSettleWorkerStartReadiness({
      runtime,
      db,
      run,
      task,
      dispatchId: started.dispatch.id,
      dispatchDepth: started.dispatch.depth,
      dispatchMaxDepth: args.controlPlane?.dispatchMaxDepth,
      preambleBuilder: args.controlPlane?.preambleBuilder,
      structuredSession,
      terminalHandle,
      coordinatorHandle: params.from,
      devMode: params.devMode,
      requestId: orchestrationMutation?.requestId ?? started.dispatch.id,
      agent: agent ?? null,
      launchedAgent: params.terminal ? null : (agent ?? null),
      setupReceipt,
      launchReceipt: launch.receipt,
      mode,
      timeoutMs: params.timeoutMs ?? 60_000,
      readinessDeadline,
      effects,
      terminalRevealWarning: placed.warning,
      onStage: (stage) => {
        failedStage = stage
      }
    })
  } catch (error) {
    await tearDownFailedWorkerStart({
      runtime,
      structuredSession: placed?.structuredSession ?? null,
      dispatchId: started.dispatch.id
    })
    return failWorkerStartWithReceipt({
      db,
      runId: run.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      failedStage,
      error,
      setup: placed?.setupReceipt ?? EXISTING_WORKTREE_SETUP,
      launch: launch.receipt,
      mode
    })
  }
}
