import { z } from 'zod'
import type { AgentFactory } from '../agent-factory/agent-factory'
import type { ContextBuilder } from '../context-builder/context-builder'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { createAttemptLauncher, type AttemptLauncherDependencies } from './attempt-launcher'
import { missionAttemptCount } from '../scheduler/admission-budget'

type Dependencies = AttemptLauncherDependencies & {
  agentFactory: AgentFactory
  contextBuilder: ContextBuilder
}
const activeStates = new Set(['starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown'])
const LaunchAudit = z.object({ worktreeId: z.string() })

export function createPlannerLauncher(deps: Dependencies) {
  const { store, db } = deps
  const pending = new Set<string>()
  const refuse = (message: string, data?: Record<string, unknown>) => {
    throw new OrchestrationError('invalid_argument', message, data)
  }
  function preflight(missionId: string) {
    const mission = deps.missions.getMission(missionId)
    if (store.listPlanRevisions(missionId).some((p) => p.status === 'PROPOSED')) {
      throw new OrchestrationError('plan_pending', 'A proposed PlanRevision is awaiting review.')
    }
    if (mission.status !== 'ANALYZING') {
      throw new OrchestrationError(
        'illegal_transition',
        `Mission must be ANALYZING to start a Planner Attempt; current status is ${mission.status}.`
      )
    }
    if (!mission.activeGoalRevisionId) {
      return refuse('Mission has no active GoalRevision.')
    }
    const bindings = store.listPlannerBindings(missionId)
    if (
      bindings.some((b) =>
        b.dispatchId
          ? db.getDispatchContextById(b.dispatchId)?.status === 'dispatched' ||
            activeStates.has(db.getWorkerDispatch(b.dispatchId)?.state ?? '')
          : !store
              .listAuditEvents({ missionId })
              .some(
                (a) =>
                  a.objectId === `${b.taskId}/${b.seq}` &&
                  ['planner.launch_failed', 'planner.attempt_failed'].includes(a.event)
              )
      )
    ) {
      return refuse('A Planner Attempt is already active for this Mission.')
    }
    const max = store.getPolicy(missionId)?.budget.maxAttempts
    const used = missionAttemptCount(store, missionId)
    if (max !== undefined && used >= max) {
      return refuse('budget_exhausted', { reason: 'budget_exhausted' })
    }
    return { mission, goalRevisionId: mission.activeGoalRevisionId, runSeq: bindings.length + 1 }
  }
  return {
    async start(missionId: string) {
      if (pending.has(missionId)) {
        return refuse('A Planner Attempt is already active for this Mission.')
      }
      const initial = preflight(missionId)
      pending.add(missionId)
      try {
        const { mission, goalRevisionId } = initial
        const agent = await deps.agentFactory.build({ missionId, role: 'planner', goalRevisionId })
        let baseBranch = `axiom/integration/${missionId}`
        try {
          await gitExecFileAsync(
            ['rev-parse', '--verify', '--quiet', `refs/heads/${baseBranch}`],
            gitOptionsForWorktree(mission.repoPath)
          )
        } catch (error) {
          if (
            !(typeof error === 'object' && error !== null && 'code' in error && error.code === 1)
          ) {
            throw error
          }
          baseBranch = mission.targetBranch
        }
        const context = await deps.contextBuilder.build({
          missionId,
          role: 'planner',
          goalRevisionId,
          repositoryRef: baseBranch,
          provider: agent.spec.provider
        })
        const { attempt, runSeq } = store.transaction('planner_admission', () => {
          const current = preflight(missionId)
          if (current.goalRevisionId !== goalRevisionId) {
            return refuse('Planner Goal changed during launch.')
          }
          const task = db.createTask({
            spec: JSON.stringify({
              kind: 'planner',
              missionId,
              goalRevisionId,
              seq: current.runSeq
            }),
            taskTitle: 'Planner',
            runId: mission.runId,
            deps: []
          })
          const attempt = {
            taskId: task.id,
            missionId,
            seq: store.nextAttemptSeq(task.id),
            branch: `axiom/planner/${missionId}/${current.runSeq}`,
            agentSpecId: agent.id,
            contextPackageId: context.packageId
          }
          store.insertAttemptBinding({ ...attempt, dispatchId: null })
          return { attempt, runSeq: current.runSeq }
        })
        await createAttemptLauncher(deps, { goalRevisionId, baseBranch, runSeq })(attempt)
        const dispatchId = store.getAttemptBinding(attempt.taskId, attempt.seq)?.dispatchId ?? null
        const audit = store
          .listAuditEvents({ missionId })
          .findLast(
            (e) =>
              e.objectId === dispatchId &&
              ['planner.started', 'planner.start_unknown', 'planner.launch_failed'].includes(
                e.event
              )
          )
        const parsed = LaunchAudit.safeParse(audit?.after)
        return {
          attempt: {
            attemptId: dispatchId,
            seq: runSeq,
            branch: attempt.branch,
            provider: agent.spec.provider,
            worktreeId:
              db.getWorkerDispatch(dispatchId ?? '')?.worktree_id ??
              (parsed.success ? parsed.data.worktreeId : null)
          }
        }
      } finally {
        pending.delete(missionId)
      }
    }
  }
}
