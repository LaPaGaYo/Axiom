import type { z } from 'zod'
import { createNonSecureContextUuid } from '../../../shared/non-secure-context-uuid'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import { RuntimeRpcEnvelopeSchema } from '../../../shared/runtime-rpc-envelope'
import * as mission from '../../../shared/axiom-contract/mission-params'
import * as plan from '../../../shared/axiom-contract/plan-params'
import { TaskListParams, TaskListResponseSchema } from '../../../shared/axiom-contract/task-params'
import { GoalShowParams, GoalResponseSchema } from '../../../shared/axiom-contract/goal-params'

export class AxiomRpcError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AxiomRpcError'
  }
}

async function call<P, R>(
  method: string,
  params: P,
  paramsSchema: z.ZodType<P>,
  responseSchema: z.ZodType<R>,
  requestId?: string
): Promise<R> {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    throw new AxiomRpcError('invalid_params', parsed.error.message)
  }
  let raw: unknown
  try {
    raw = await window.api.runtime.call({
      method,
      params: parsed.data,
      ...(requestId === undefined
        ? {}
        : {
            envelope: {
              orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
              orchestrationRequestId: requestId
            }
          })
    })
  } catch (error) {
    throw new AxiomRpcError(
      'transport_error',
      error instanceof Error ? error.message : String(error)
    )
  }
  const envelope = RuntimeRpcEnvelopeSchema.safeParse(raw)
  if (!envelope.success || !('ok' in envelope.data)) {
    throw new AxiomRpcError('invalid_response', 'Invalid runtime response')
  }
  if (!envelope.data.ok) {
    throw new AxiomRpcError(envelope.data.error.code, envelope.data.error.message)
  }
  const result = responseSchema.safeParse(envelope.data.result)
  if (!result.success) {
    throw new AxiomRpcError('invalid_response', 'Invalid Axiom response')
  }
  return result.data
}

export const axiomClient = {
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
