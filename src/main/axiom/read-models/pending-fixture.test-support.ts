import { expect } from 'vitest'
import { z } from 'zod'
import { rpcFixture } from '../rpc-fixture.test-support'
import { MissionController } from '../mission-controller/mission-controller'
import { planned } from '../mission-controller/controller-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { TaskListItemSchema } from '../../../shared/axiom-contract/task-params'
import type { MissionStatus, TaskStage } from '../../../shared/axiom-contract/lifecycle'
import type { AuditEvent, Policy } from '../../../shared/axiom-contract/mission-objects'
import {
  AxiomMessagePayloadSchema,
  axiomMessageRoutingType
} from '../../../shared/axiom-contract/message-params'

export const WaitingSchema = z.strictObject({
  on: z.enum([
    'none',
    'mission',
    'dependency',
    'question',
    'approval',
    'budget',
    'admission',
    'verification',
    'integration',
    'human',
    'running'
  ]),
  reason: z.string(),
  person: z.boolean(),
  taskIds: z.array(z.string()).optional(),
  runId: z.string().optional(),
  seq: z.number().optional(),
  until: z.string().optional(),
  missionStatus: z.string().optional(),
  budget: z
    .strictObject({
      scope: z.enum(['task', 'mission']),
      dimension: z.string(),
      limit: z.number(),
      used: z.number()
    })
    .optional()
})
const TaskViewSchema = TaskListItemSchema.extend({ waitingOn: WaitingSchema })
export const PendingItemSchema = z.strictObject({
  id: z.string(),
  kind: z.enum([
    'mission',
    'plan_review',
    'question',
    'human_review',
    'task_blocked',
    'subtask_request',
    'follow_up',
    'stall_notice',
    'supervision_proposal'
  ]),
  objectId: z.string(),
  taskId: z.string().optional(),
  reason: z.string(),
  summary: z.string().optional(),
  blocking: z.boolean(),
  blocks: z.number().int().nonnegative(),
  actions: z.array(z.string()),
  since: z.string().datetime(),
  waitingOn: WaitingSchema.optional()
})
export type PendingItem = z.infer<typeof PendingItemSchema>
export const recordedAt = '2026-11-01T12:00:00.000Z'

export function pendingFixture(executing = true) {
  const rpc = rpcFixture()
  const controller = new MissionController(rpc.db, rpc.store)
  const f = { ...rpc, ...planned({ ...rpc, controller }) }
  if (executing) {
    controller.startExecution(f.missionId)
  }
  const mission = controller.getMission(f.missionId)
  const task = (id: string) => {
    const row = f.store
      .listTaskStages({ missionId: f.missionId })
      .find((t) => t.spec.id === id || t.taskId === id)
    if (!row) {
      throw new Error(`Missing pending fixture Task ${id}`)
    }
    return row
  }
  function audit(
    objectKind: AuditEvent['objectKind'],
    objectId: string,
    event: string,
    after: AuditEvent['after'],
    createdAt = recordedAt
  ) {
    return f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'fixture',
      objectKind,
      objectId,
      event,
      before: null,
      after,
      createdAt
    })
  }
  function stage(id: string, to: TaskStage, reason = 'fixture_stage', attemptCountDelta = 0) {
    const row = task(id)
    f.store.updateTaskStage({
      taskId: row.taskId,
      from: row.stage,
      to,
      previousStage: row.stage,
      attemptCountDelta
    })
    audit('task', row.taskId, 'task.stage', { stage: to, previousStage: row.stage, reason })
    return task(id)
  }
  function status(to: MissionStatus, reason = 'fixture_status') {
    const current = f.store.getMission(f.missionId)
    if (!current) {
      throw new Error('Missing pending fixture Mission')
    }
    f.store.updateMissionStatus({
      id: f.missionId,
      from: current.status,
      to,
      previousStatus: current.status
    })
    audit('mission', f.missionId, 'mission.status', { status: to, reason })
  }
  function policy(patch: Partial<Policy>) {
    const current = f.store.getPolicy(f.missionId)
    if (!current) {
      throw new Error('Missing pending fixture policy')
    }
    f.store.upsertPolicy(f.missionId, { ...current, ...patch })
  }
  function message(
    id: string,
    body: Partial<z.input<typeof AxiomMessagePayloadSchema>['axiom']> = {}
  ) {
    const row = task(id)
    const payload = AxiomMessagePayloadSchema.parse({
      axiom: {
        version: 1,
        type: 'QUESTION',
        missionId: f.missionId,
        taskId: row.taskId,
        attemptId: `attempt-${id}`,
        summary: `Question for ${id}`,
        artifactIds: [],
        related: {},
        question: { text: `Question for ${id}`, options: [] },
        ...body
      }
    })
    return f.db.insertMessage({
      from: 'fixture',
      to: `run:${mission.runId}`,
      runId: mission.runId,
      type: axiomMessageRoutingType(payload.axiom.type),
      subject: payload.axiom.summary,
      payload: JSON.stringify(payload)
    })
  }
  async function show(id: string) {
    const response = await f.call('axiom.task.show', { taskId: task(id).taskId })
    expect(response, JSON.stringify(response)).toMatchObject({
      ok: true,
      result: { task: { waitingOn: expect.any(Object) } }
    })
    if (!response.ok) {
      throw new Error(response.error.code)
    }
    return z.object({ task: TaskViewSchema }).parse(response.result).task
  }
  async function list() {
    const response = await f.call('axiom.task.list', { missionId: f.missionId })
    expect(response, JSON.stringify(response)).toMatchObject({
      ok: true,
      result: { tasks: expect.any(Array) }
    })
    if (!response.ok) {
      throw new Error(response.error.code)
    }
    const rows = z
      .object({ tasks: z.array(z.record(z.string(), z.unknown())) })
      .parse(response.result).tasks
    for (const row of rows) {
      expect(row.waitingOn).toEqual(expect.any(Object))
    }
    return z.array(TaskViewSchema).parse(rows)
  }
  async function pending() {
    const response = await f.call('axiom.mission.pending', { missionId: f.missionId })
    expect(response, JSON.stringify(response)).toMatchObject({
      ok: true,
      result: { missionId: f.missionId, items: expect.any(Array) }
    })
    if (!response.ok) {
      throw new Error(response.error.code)
    }
    return z
      .object({ missionId: z.string(), items: z.array(PendingItemSchema) })
      .parse(response.result)
  }
  async function close() {
    await getAxiomControlPlane(f.runtime).effects.stop()
    f.db.close()
  }
  return { ...f, mission, task, audit, stage, status, policy, message, show, list, pending, close }
}
export type PendingFixture = ReturnType<typeof pendingFixture>
