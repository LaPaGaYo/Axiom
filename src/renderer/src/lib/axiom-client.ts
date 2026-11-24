import { z } from 'zod'
import { createNonSecureContextUuid } from '../../../shared/non-secure-context-uuid'
import * as mission from '../../../shared/axiom-contract/mission-params'
import * as plan from '../../../shared/axiom-contract/plan-params'
import * as attempt from '../../../shared/axiom-contract/attempt-params'
import * as message from '../../../shared/axiom-contract/message-params'
import * as verification from '../../../shared/axiom-contract/verification-params'
import * as artifact from '../../../shared/axiom-contract/artifact-params'
import * as usage from '../../../shared/axiom-contract/token-usage'
import * as pending from '../../../shared/axiom-contract/mission-pending'
import { call } from './axiom-rpc-call'
export { AxiomRpcError } from './axiom-rpc-call'
import * as policy from '../../../shared/axiom-contract/policy-params'
import * as supervision from '../../../shared/axiom-contract/supervision'
import {
  TaskListParams,
  TaskListResponseSchema,
  TaskShowParams,
  TaskAdjustParams,
  TaskCancelParams,
  TaskResponseSchema
} from '../../../shared/axiom-contract/task-params'
import { GoalShowParams, GoalResponseSchema } from '../../../shared/axiom-contract/goal-params'

export const axiomClient = {
  showPolicy: (params: z.infer<typeof policy.PolicyShowParams>) =>
    call('axiom.policy.show', params, policy.PolicyShowParams, policy.PolicyResponseSchema),
  updatePolicy: (
    params: z.infer<typeof policy.PolicyUpdateParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.policy.update',
      params,
      policy.PolicyUpdateParams,
      policy.PolicyResponseSchema,
      requestId
    ),
  showSupervision: (params: z.infer<typeof supervision.SupervisionShowParams>) =>
    call(
      'axiom.supervision.show',
      params,
      supervision.SupervisionShowParams,
      supervision.SupervisionShowResponse
    ),
  updateSupervision: (
    params: z.infer<typeof supervision.SupervisionUpdateParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.supervision.update',
      params,
      supervision.SupervisionUpdateParams,
      supervision.SupervisionUpdateResponse,
      requestId
    ),
  resolveSupervision: (
    params: z.infer<typeof supervision.SupervisionResolveParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.supervision.resolve',
      params,
      supervision.SupervisionResolveParams,
      supervision.SupervisionResolveResponse,
      requestId
    ),
  showTask: (params: z.infer<typeof TaskShowParams>) =>
    call('axiom.task.show', params, TaskShowParams, TaskResponseSchema),
  adjustTask: (
    params: z.infer<typeof TaskAdjustParams>,
    requestId: string = createNonSecureContextUuid()
  ) => call('axiom.task.adjust', params, TaskAdjustParams, TaskResponseSchema, requestId),
  cancelTask: (
    params: z.infer<typeof TaskCancelParams>,
    requestId: string = createNonSecureContextUuid()
  ) => call('axiom.task.cancel', params, TaskCancelParams, TaskResponseSchema, requestId),
  missionPending: (params: z.infer<typeof pending.MissionPendingParams>) =>
    call(
      'axiom.mission.pending',
      params,
      pending.MissionPendingParams,
      pending.MissionPendingResponseSchema
    ),
  resolveVerification: (
    params: z.infer<typeof verification.VerificationResolveParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.verification.resolve',
      params,
      verification.VerificationResolveParams,
      z.object({ runId: z.string(), status: z.enum(['PASS', 'FAIL']) }),
      requestId
    ),
  rerunVerification: (
    params: z.infer<typeof verification.VerificationRerunParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.verification.rerun',
      params,
      verification.VerificationRerunParams,
      z.object({ runId: z.string(), status: z.literal('QUEUED') }),
      requestId
    ),
  listVerificationRuns: (params: z.infer<typeof verification.VerificationListParams>) =>
    call(
      'axiom.verification.list',
      params,
      verification.VerificationListParams,
      verification.VerificationListResponseSchema
    ),
  readArtifact: (params: z.infer<typeof artifact.ArtifactReadParams>) =>
    call(
      'axiom.artifact.read',
      params,
      artifact.ArtifactReadParams,
      artifact.ArtifactReadResponseSchema
    ),
  missionUsage: (params: z.infer<typeof usage.MissionUsageParams>) =>
    call('axiom.mission.usage', params, usage.MissionUsageParams, usage.MissionUsageResponseSchema),
  listAttempts: (params: z.infer<typeof attempt.AttemptListParams>) =>
    call(
      'axiom.attempt.list',
      params,
      attempt.AttemptListParams,
      attempt.AttemptListResponseSchema
    ),
  showAttempt: (params: z.infer<typeof attempt.AttemptShowParams>) =>
    call('axiom.attempt.show', params, attempt.AttemptShowParams, attempt.AttemptResponseSchema),
  listMessages: (params: z.infer<typeof message.MessageListParams>) =>
    call(
      'axiom.message.list',
      params,
      message.MessageListParams,
      message.MessageListResponseSchema
    ),
  answerMessage: (
    params: z.infer<typeof message.MessageAnswerParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.message.answer',
      params,
      message.MessageAnswerParams,
      z.object({
        question: z.object({ message_id: z.string(), status: z.literal('answered') }),
        message: z.object({ id: z.string() }),
        duplicate: z.boolean()
      }),
      requestId
    ),
  resolveMessage: (
    params: z.infer<typeof message.MessageResolveParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.message.resolve',
      params,
      message.MessageResolveParams,
      z.object({
        resolved: z.literal(true),
        decision: z.enum(['accept', 'reject']),
        reason: z.string(),
        taskId: z.string().optional()
      }),
      requestId
    ),
  planMission: (
    params: z.infer<typeof mission.MissionPlanParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.mission.plan',
      params,
      mission.MissionPlanParams,
      mission.MissionPlanResponseSchema,
      requestId
    ),
  listMissions: (params: z.infer<typeof mission.MissionListParams> = {}) =>
    call(
      'axiom.mission.list',
      params,
      mission.MissionListParams,
      mission.MissionListResponseSchema
    ),
  showMission: (params: z.infer<typeof mission.MissionShowParams>) =>
    call('axiom.mission.show', params, mission.MissionShowParams, mission.MissionResponseSchema),
  createMission: (
    params: z.input<typeof mission.MissionCreateParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.mission.create',
      params,
      mission.MissionCreateParams,
      mission.MissionCreateResponseSchema,
      requestId
    ),
  startMission: (
    params: z.infer<typeof mission.MissionStartParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.mission.start',
      params,
      mission.MissionStartParams,
      mission.MissionResponseSchema,
      requestId
    ),
  pauseMission: (
    params: z.infer<typeof mission.MissionPauseParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.mission.pause',
      params,
      mission.MissionPauseParams,
      mission.MissionResponseSchema,
      requestId
    ),
  resumeMission: (
    params: z.infer<typeof mission.MissionResumeParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.mission.resume',
      params,
      mission.MissionResumeParams,
      mission.MissionResponseSchema,
      requestId
    ),
  cancelMission: (
    params: z.infer<typeof mission.MissionCancelParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call(
      'axiom.mission.cancel',
      params,
      mission.MissionCancelParams,
      mission.MissionResponseSchema,
      requestId
    ),
  showGoal: (params: z.infer<typeof GoalShowParams>) =>
    call('axiom.goal.show', params, GoalShowParams, GoalResponseSchema),
  listPlans: (params: z.infer<typeof plan.PlanListParams>) =>
    call('axiom.plan.list', params, plan.PlanListParams, plan.PlanListResponseSchema),
  showPlan: (params: z.infer<typeof plan.PlanShowParams>) =>
    call('axiom.plan.show', params, plan.PlanShowParams, plan.PlanResponseSchema),
  approvePlan: (
    params: z.infer<typeof plan.PlanApproveParams>,
    requestId: string = createNonSecureContextUuid()
  ) =>
    call('axiom.plan.approve', params, plan.PlanApproveParams, plan.PlanResponseSchema, requestId),
  rejectPlan: (
    params: z.infer<typeof plan.PlanRejectParams>,
    requestId: string = createNonSecureContextUuid()
  ) => call('axiom.plan.reject', params, plan.PlanRejectParams, plan.PlanResponseSchema, requestId),
  listTasks: (params: z.infer<typeof TaskListParams>) =>
    call('axiom.task.list', params, TaskListParams, TaskListResponseSchema)
}
