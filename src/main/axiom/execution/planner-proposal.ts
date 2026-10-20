import type { z } from 'zod'
import type { PlanProposeParams } from '../../../shared/axiom-contract/plan-params'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import type { RpcContext } from '../../runtime/rpc/core'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { getAxiomControlPlane } from '../control-plane'
import { resolveAttemptSender } from './attempt-authority'
import { stopPlanner } from './planner-stop'

export const PLANNER_STOP_GRACE_MS = 2_000

export async function proposePlannerPlan(
  p: z.infer<typeof PlanProposeParams> & { attemptId: string },
  ctx: RpcContext
) {
  const { runtime, orchestrationCaller, orchestrationCapability } = ctx
  const db = runtime.getOrchestrationDb()
  const { store, missions } = getAxiomControlPlane(runtime)
  const authority = () => {
    const result = resolveAttemptSender({
      runtime,
      db,
      store,
      role: 'planner',
      attemptId: p.attemptId,
      from: orchestrationCaller?.address ?? p.from ?? '',
      orchestrationCaller,
      orchestrationCapability
    })
    const spec = store.getAgentSpec(result.binding.agentSpecId)?.spec
    if (
      result.mission.id !== p.missionId ||
      spec?.role !== 'planner' ||
      spec.goalRevisionId !== p.planRevision.goalRevisionId
    ) {
      throw new OrchestrationError(
        'task_dispatch_mismatch',
        'Planner Mission or Goal does not match.'
      )
    }
    return { ...result, spec }
  }
  const { binding } = authority()
  const worktreeId = db.getWorkerDispatch(p.attemptId)?.worktree_id
  const worktree = worktreeId ? splitWorktreeIdForFilesystem(worktreeId) : undefined
  if (!worktree?.worktreePath || !worktree.repoId) {
    throw new OrchestrationError(
      'planner_worktree_missing',
      'Planner Attempt has no worktree path.'
    )
  }
  const status = await gitExecFileAsync(
    ['status', '--porcelain'],
    gitOptionsForWorktree(worktree.worktreePath)
  )
  if (status.stdout.trim()) {
    const files = status.stdout.split(/\r?\n/).filter(Boolean)
    store.appendAuditEvent({
      missionId: p.missionId,
      actor: 'MissionController',
      objectKind: 'attempt',
      objectId: p.attemptId,
      event: 'planner.rejected',
      before: null,
      after: { reason: 'planner_worktree_dirty', files }
    })
    throw new OrchestrationError(
      'planner_worktree_dirty',
      `Planner worktree must be clean before proposing a plan:\n${files.join('\n')}`,
      { files }
    )
  }
  const result = store.transaction('planner_proposal', () => {
    const { spec } = authority()
    if (!p.planRevision.tasks.length) {
      throw new OrchestrationError(
        'invalid_argument',
        'Planner proposal needs at least one root.',
        { reason: 'plan_invalid' }
      )
    }
    const planRevision = missions.proposePlan({
      missionId: p.missionId,
      planRevision: p.planRevision,
      provenance: {
        kind: 'planner',
        actor: spec.provider,
        ...(spec.model === 'policy-default' ? {} : { model: spec.model }),
        at: new Date().toISOString()
      }
    })
    const downstream = new Set(planRevision.edges.map((e) => e.toTaskId))
    store.appendAuditEvent({
      missionId: p.missionId,
      actor: 'MissionController',
      objectKind: 'attempt',
      objectId: p.attemptId,
      event: 'planner.proposed',
      before: null,
      after: {
        attemptId: p.attemptId,
        planRevisionId: planRevision.id,
        taskCount: planRevision.tasks.length,
        edgeCount: planRevision.edges.length,
        rootCount: planRevision.tasks.filter((t) => !downstream.has(t.id)).length
      }
    })
    // Bind the durable receipt to settlement before stopping the process that called us.
    const response = { planRevision }
    ctx.recordMutationReceipt?.(response)
    return response
  })
  // Let the CLI receive its receipt before closing its process tree; recovery covers a lost timer.
  setTimeout(() => {
    void stopPlanner(
      runtime,
      store,
      { missionId: binding.missionId, dispatchId: p.attemptId },
      'plan_proposed'
    ).catch(() => {
      console.warn('[axiom] Planner stop failed', {
        missionId: binding.missionId,
        dispatchId: p.attemptId
      })
    })
  }, PLANNER_STOP_GRACE_MS).unref()
  return result
}
