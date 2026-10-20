import { budgetExhaustion, type BudgetExhaustion } from './admission-budget'
import type {
  AuditEvent,
  Policy,
  TaskStageRecord
} from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import { canBecomeReady } from '../mission-controller/task-readiness'
import type { ContextBuilder } from '../context-builder/context-builder'
import { AgentFactoryError, type AgentFactory } from '../agent-factory/agent-factory'
import { blockingQuestionOrApproval } from './admission-blockers'
import { orderByCriticalPath } from './critical-path'
import { settleAttemptWithoutSubmission } from '../execution/attempt-settlement'

export type ScheduleTrigger = 'mission_start' | 'stage_change' | 'resume' | 'manual'
export type AdmittedAttempt = {
  missionId: string
  taskId: string
  seq: number
  branch: string
  agentSpecId: string
  contextPackageId: string
}
export type AttemptLaunch = (attempt: AdmittedAttempt) => Promise<void>
export type ScheduleRoundResult = {
  admitted: AdmittedAttempt[]
  skipped: {
    taskId: string
    reason:
      | 'concurrency'
      | 'provider_concurrency'
      | 'task_attempts'
      | 'question'
      | 'approval'
      | 'no_eligible_provider'
      | 'stale'
  }[]
  blocked?: 'maxAttempts' | 'maxWallClockMinutes'
}
type SkipReason = ScheduleRoundResult['skipped'][number]['reason']
type Check =
  | { reason: SkipReason }
  | { budget: BudgetExhaustion }
  | { task: TaskStageRecord; policy: Policy }
type Flight = { pending?: ScheduleTrigger; promise: Promise<ScheduleRoundResult> }

export class Scheduler {
  // Only coalescing handles live here. Each round rereads all durable scheduling state.
  private readonly flights = new Map<string, Flight>()
  private readonly now: () => string

  constructor(
    private readonly db: OrchestrationDb,
    private readonly store: AxiomStore,
    private readonly missions: MissionController,
    private readonly contextBuilder: ContextBuilder,
    private readonly agentFactory: AgentFactory,
    private readonly deps: { launch: AttemptLaunch; now?: () => string }
  ) {
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  scheduleRound(missionId: string, trigger: ScheduleTrigger): Promise<ScheduleRoundResult> {
    const active = this.flights.get(missionId)
    if (active) {
      active.pending = trigger
      return active.promise
    }
    const flight: Flight = {
      // Defer execution until the handle exists, including readiness-trigger reentry.
      promise: Promise.resolve()
        .then(async () => {
          const result: ScheduleRoundResult = { admitted: [], skipped: [] }
          let next: ScheduleTrigger | undefined = trigger
          while (next) {
            flight.pending = undefined
            const round = await this.runRound(missionId, next)
            result.admitted.push(...round.admitted)
            result.skipped.push(...round.skipped)
            if (round.blocked) {
              result.blocked = round.blocked
            }
            next = flight.pending
          }
          return result
        })
        .finally(() => {
          this.flights.delete(missionId)
        })
    }
    this.flights.set(missionId, flight)
    return flight.promise
  }

  private check(missionId: string, taskId: string): Check {
    const mission = this.store.getMission(missionId)
    const task = this.store.getTaskStage(taskId)
    const policy = this.store.getPolicy(missionId)
    if (
      mission?.status !== 'EXECUTING' ||
      !task ||
      task.missionId !== missionId ||
      task.stage !== 'READY' ||
      !policy
    ) {
      return { reason: 'stale' }
    }
    const budget = budgetExhaustion(this.store, missionId, policy, this.now)
    if (budget) {
      return { budget }
    }
    if (task.attemptCount >= task.retryPolicy.maxAttempts) {
      return { reason: 'task_attempts' }
    }
    const blocker = blockingQuestionOrApproval({ db: this.db, store: this.store }, task)
    if (blocker !== 'none') {
      return { reason: blocker }
    }
    if (!canBecomeReady({ db: this.db, store: this.store }, task)) {
      return { reason: 'stale' }
    }
    return { task, policy }
  }

  private block(missionId: string, budget: BudgetExhaustion): void {
    this.missions.blockMission(missionId, 'budget_exhausted')
    this.audit(missionId, 'budget.exhausted', 'mission', missionId, budget)
  }

  private audit(
    missionId: string,
    event: string,
    objectKind: string,
    objectId: string,
    after: AuditEvent['after']
  ): void {
    this.store.appendAuditEvent({
      missionId,
      actor: 'Scheduler',
      event,
      objectKind,
      objectId,
      before: null,
      after,
      createdAt: this.now()
    })
  }

  private async runRound(
    missionId: string,
    trigger: ScheduleTrigger
  ): Promise<ScheduleRoundResult> {
    const result: ScheduleRoundResult = { admitted: [], skipped: [] }
    if (this.store.getMission(missionId)?.status !== 'EXECUTING') {
      return result
    }
    this.missions.recomputeReadiness(missionId)
    const candidates = orderByCriticalPath(
      this.store,
      this.store.listTaskStages({ missionId, stage: 'READY' })
    )
    const launch = this.deps.launch
    try {
      for (const candidate of candidates) {
        const before = this.store.transaction('scheduler_precheck', () => {
          const check = this.check(missionId, candidate.taskId)
          if ('budget' in check) {
            this.block(missionId, check.budget)
          }
          return check
        })
        if ('budget' in before) {
          result.blocked = before.budget.dimension
          break
        }
        if ('reason' in before) {
          result.skipped.push({ taskId: candidate.taskId, reason: before.reason })
          continue
        }
        if (this.store.countTaskStages(missionId).RUNNING >= before.policy.concurrencyLimit) {
          result.skipped.push({ taskId: candidate.taskId, reason: 'concurrency' })
          continue
        }
        let contracts: { agentSpecId: string; contextPackageId: string }
        try {
          const context = await this.contextBuilder.build({ missionId, taskId: candidate.taskId })
          const agent = await this.agentFactory.build({
            missionId,
            taskId: candidate.taskId,
            role: 'worker',
            contextPackageId: context.packageId
          })
          contracts = { agentSpecId: agent.id, contextPackageId: context.packageId }
        } catch (error) {
          if (!(error instanceof AgentFactoryError) || error.code !== 'no_eligible_provider') {
            throw error
          }
          result.skipped.push({ taskId: candidate.taskId, reason: 'no_eligible_provider' })
          continue
        }
        const admitted = this.admit(before, contracts)
        if ('budget' in admitted) {
          result.blocked = admitted.budget.dimension
          break
        }
        if ('reason' in admitted) {
          result.skipped.push({ taskId: candidate.taskId, reason: admitted.reason })
          continue
        }
        result.admitted.push(admitted)
        try {
          await launch(admitted)
        } catch {
          // Provider errors may contain credentials; preserve identity, not arbitrary text.
          this.audit(
            missionId,
            'attempt.launch_failed',
            'attempt',
            `${admitted.taskId}/${admitted.seq}`,
            { reason: 'launch_rejected' }
          )
          // The helper only settles this unbound admission; bound dispatches belong to recovery.
          settleAttemptWithoutSubmission(
            { store: this.store, missions: this.missions },
            {
              ...admitted,
              dispatchId: null,
              reason: 'launch_rejected',
              actor: 'Scheduler'
            }
          )
        }
      }
      return result
    } finally {
      if (result.admitted.length || result.blocked) {
        this.audit(missionId, 'scheduler.round', 'mission', missionId, {
          trigger,
          admitted: result.admitted,
          skipped: result.skipped
        })
      }
    }
  }

  private admit(
    before: { task: TaskStageRecord; policy: Policy },
    contracts: { agentSpecId: string; contextPackageId: string }
  ): AdmittedAttempt | { reason: SkipReason } | { budget: BudgetExhaustion } {
    const { missionId, taskId } = before.task
    return this.store.transaction('scheduler_admission', () => {
      const current = this.check(missionId, taskId)
      if ('budget' in current) {
        this.block(missionId, current.budget)
        return current
      }
      if ('reason' in current) {
        return current
      }
      if (
        JSON.stringify(current.task) !== JSON.stringify(before.task) ||
        JSON.stringify(current.policy) !== JSON.stringify(before.policy)
      ) {
        return { reason: 'stale' }
      }
      // This count must be read under the same write lock as the binding and stage CAS.
      if (this.store.countTaskStages(missionId).RUNNING >= current.policy.concurrencyLimit) {
        return { reason: 'concurrency' }
      }
      const context = this.store.getContextPackage(contracts.contextPackageId)
      const spec = this.store.getAgentSpec(contracts.agentSpecId)?.spec
      if (
        !context ||
        context.missionId !== missionId ||
        context.taskId !== taskId ||
        context.planRevisionId !== current.task.planRevisionId ||
        !spec ||
        spec.role !== 'worker' ||
        spec.missionId !== missionId ||
        spec.taskId !== taskId ||
        spec.contextPackageId !== context.id
      ) {
        return { reason: 'stale' }
      }
      const cap = current.policy.routing.providerConcurrency[spec.provider]
      if (
        cap !== undefined &&
        this.store.countRunningTasksForProvider(missionId, spec.provider) >= cap
      ) {
        return { reason: 'provider_concurrency' }
      }
      const seq = this.store.nextAttemptSeq(taskId)
      const attempt = {
        missionId,
        taskId,
        seq,
        branch: `axiom/attempt/${taskId}/${seq}`,
        ...contracts
      }
      this.store.insertAttemptBinding({ ...attempt, dispatchId: null })
      this.missions.transitionTaskStage({
        taskId,
        to: 'RUNNING',
        actor: 'Scheduler',
        reason: 'admission',
        attemptCountDelta: 1
      })
      this.audit(missionId, 'attempt.admitted', 'attempt', `${taskId}/${seq}`, attempt)
      return attempt
    })
  }
}
