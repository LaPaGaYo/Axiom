import type { BudgetExhaustion } from './admission-budget'

export type ScheduleTrigger =
  | 'mission_start'
  | 'stage_change'
  | 'resume'
  | 'manual'
  | 'policy'
  | 'sweep'
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
      | 'task_tokens'
      | 'question'
      | 'approval'
      | 'backoff'
      | 'no_eligible_provider'
      | 'stale'
  }[]
  blocked?: BudgetExhaustion['dimension']
}
