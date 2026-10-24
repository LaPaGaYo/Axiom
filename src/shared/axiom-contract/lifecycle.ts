import { z } from 'zod'

export const MISSION_STATUSES = [
  'DRAFT',
  'ANALYZING',
  'PLAN_REVIEW',
  'PLANNED',
  'EXECUTING',
  'REPLANNING',
  'FINALIZING',
  'READY_FOR_APPROVAL',
  'COMPLETED',
  'PAUSED',
  'BLOCKED',
  'FAILED',
  'CANCELED'
] as const
export const GOAL_REVISION_STATUSES = ['PROPOSED', 'ACTIVE', 'SUPERSEDED'] as const
export const PLAN_REVISION_STATUSES = ['PROPOSED', 'APPROVED', 'SUPERSEDED', 'REJECTED'] as const
export const TASK_STAGES = [
  'DEFINED',
  'READY',
  'RUNNING',
  'SUBMITTED',
  'VERIFYING',
  'VERIFIED',
  'INTEGRATION_READY',
  'INTEGRATED',
  'NEEDS_FIX',
  'BLOCKED',
  'CANCELED'
] as const
export const ATTEMPT_STATES = [
  'LAUNCH_PENDING',
  'STARTING',
  'RUNNING',
  'SUBMITTED',
  'FAILED',
  'STOPPED',
  'ABANDONED',
  'START_UNKNOWN',
  'STOP_UNKNOWN'
] as const
export const AttemptStateSchema = z.enum(ATTEMPT_STATES)
export type AttemptState = z.infer<typeof AttemptStateSchema>
export const CANDIDATE_STATUSES = ['ACTIVE', 'SUPERSEDED'] as const
export const VERIFICATION_RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'PASS',
  'FAIL',
  'INCONCLUSIVE',
  'SPECIALIST_REVIEW',
  'HUMAN_REVIEW',
  'CANCELED'
] as const
export const CandidateStatusSchema = z.enum(CANDIDATE_STATUSES)
export const VerificationRunStatusSchema = z.enum(VERIFICATION_RUN_STATUSES)
export type VerificationRunStatus = z.infer<typeof VerificationRunStatusSchema>
export const VERIFICATION_RUN_TRANSITIONS: Readonly<
  Record<VerificationRunStatus, readonly VerificationRunStatus[]>
> = {
  QUEUED: ['RUNNING', 'CANCELED'],
  RUNNING: ['PASS', 'FAIL', 'INCONCLUSIVE', 'QUEUED', 'CANCELED'],
  INCONCLUSIVE: ['SPECIALIST_REVIEW', 'HUMAN_REVIEW', 'CANCELED'],
  SPECIALIST_REVIEW: ['PASS', 'FAIL', 'HUMAN_REVIEW', 'CANCELED'],
  HUMAN_REVIEW: ['PASS', 'FAIL', 'CANCELED'],
  PASS: [],
  FAIL: [],
  CANCELED: []
}
export function isLegalVerificationRunTransition(
  from: VerificationRunStatus,
  to: VerificationRunStatus
): boolean {
  return VERIFICATION_RUN_TRANSITIONS[from].includes(to)
}
export const REPLAN_LEVELS = ['NO_REPLAN', 'MINOR_ADJUSTMENT', 'MAJOR_REPLAN'] as const
export const BLOCKING_APPROVAL_ACTION_KINDS = ['budget_increase'] as const
export const RISK_LEVELS = ['low', 'medium', 'high'] as const
export const READINESS_THRESHOLDS = ['INTEGRATED', 'VERIFIED'] as const
export const TASK_DISPOSITIONS = ['inherit', 'cancel', 'rebind'] as const
export const AXIOM_MESSAGE_TYPES = [
  'INFORM',
  'REQUEST',
  'QUESTION',
  'DECISION',
  'BLOCKED',
  'HANDOFF',
  'REQUEST_SUBTASK',
  'SUBMISSION'
] as const

export const MissionStatusSchema = z.enum(MISSION_STATUSES)
export const GoalRevisionStatusSchema = z.enum(GOAL_REVISION_STATUSES)
export const PlanRevisionStatusSchema = z.enum(PLAN_REVISION_STATUSES)
export const TaskStageSchema = z.enum(TASK_STAGES)
export const ReplanLevelSchema = z.enum(REPLAN_LEVELS)
export const RiskLevelSchema = z.enum(RISK_LEVELS)
export const ReadinessThresholdSchema = z.enum(READINESS_THRESHOLDS)
export const TaskDispositionSchema = z.enum(TASK_DISPOSITIONS)
export const AxiomMessageTypeSchema = z.enum(AXIOM_MESSAGE_TYPES)

export type MissionStatus = z.infer<typeof MissionStatusSchema>
export type GoalRevisionStatus = z.infer<typeof GoalRevisionStatusSchema>
export type PlanRevisionStatus = z.infer<typeof PlanRevisionStatusSchema>
export type TaskStage = z.infer<typeof TaskStageSchema>
export type ReplanLevel = z.infer<typeof ReplanLevelSchema>
export type RiskLevel = z.infer<typeof RiskLevelSchema>
export type ReadinessThreshold = z.infer<typeof ReadinessThresholdSchema>
export type TaskDisposition = z.infer<typeof TaskDispositionSchema>
export type AxiomMessageType = z.infer<typeof AxiomMessageTypeSchema>

export const TERMINAL_MISSION_STATUSES: ReadonlySet<MissionStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELED'
])
export const TERMINAL_TASK_STAGES: ReadonlySet<TaskStage> = new Set(['INTEGRATED', 'CANCELED'])

// These tables admit transitions, not authority or readiness. The Control Plane
// must check policy and match a resume/unblock target to the persisted previous state.
export const MISSION_TRANSITIONS: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  DRAFT: ['ANALYZING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  ANALYZING: ['PLAN_REVIEW', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  PLAN_REVIEW: ['PLANNED', 'ANALYZING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  PLANNED: ['EXECUTING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  EXECUTING: ['REPLANNING', 'FINALIZING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  REPLANNING: ['EXECUTING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  FINALIZING: ['READY_FOR_APPROVAL', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  READY_FOR_APPROVAL: ['COMPLETED', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'],
  PAUSED: [
    'DRAFT',
    'ANALYZING',
    'PLAN_REVIEW',
    'PLANNED',
    'EXECUTING',
    'REPLANNING',
    'FINALIZING',
    'READY_FOR_APPROVAL',
    'BLOCKED',
    'FAILED',
    'CANCELED'
  ],
  BLOCKED: [
    'DRAFT',
    'ANALYZING',
    'PLAN_REVIEW',
    'PLANNED',
    'EXECUTING',
    'REPLANNING',
    'FINALIZING',
    'READY_FOR_APPROVAL',
    'PAUSED',
    'FAILED',
    'CANCELED'
  ],
  COMPLETED: [],
  FAILED: [],
  CANCELED: []
}

export const TASK_STAGE_TRANSITIONS: Readonly<Record<TaskStage, readonly TaskStage[]>> = {
  DEFINED: ['READY', 'BLOCKED', 'CANCELED'],
  READY: ['RUNNING', 'BLOCKED', 'CANCELED'],
  RUNNING: ['SUBMITTED', 'NEEDS_FIX', 'BLOCKED', 'CANCELED'],
  SUBMITTED: ['VERIFYING', 'BLOCKED', 'CANCELED'],
  VERIFYING: ['VERIFIED', 'NEEDS_FIX', 'BLOCKED', 'CANCELED'],
  VERIFIED: ['INTEGRATION_READY', 'BLOCKED', 'CANCELED'],
  INTEGRATION_READY: ['INTEGRATED', 'NEEDS_FIX', 'BLOCKED', 'CANCELED'],
  NEEDS_FIX: ['READY', 'BLOCKED', 'CANCELED'],
  BLOCKED: [
    'DEFINED',
    'READY',
    'RUNNING',
    'SUBMITTED',
    'VERIFYING',
    'VERIFIED',
    'INTEGRATION_READY',
    'NEEDS_FIX',
    'CANCELED'
  ],
  INTEGRATED: [],
  CANCELED: []
}

export function isLegalMissionTransition(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_TRANSITIONS[from].includes(to)
}

export function isLegalTaskStageTransition(from: TaskStage, to: TaskStage): boolean {
  return TASK_STAGE_TRANSITIONS[from].includes(to)
}
