import { describe, expect, it } from 'vitest'
import {
  TaskCancelParams,
  TaskCreateParams,
  TaskListItemSchema,
  TaskListParams,
  TaskShowParams
} from './task-params'
import { makeProposal } from './contract-fixtures.test-support'

const create = {
  missionId: 'm',
  spec: makeProposal().tasks[0],
  edges: [],
  rationale: 'Repair integration regression',
  replanLevel: 'MINOR_ADJUSTMENT'
}
describe('axiom.task params', () => {
  it.each([
    [
      'list',
      TaskListParams,
      { missionId: 'm', stage: 'SUBMITTED' },
      { missionId: 'm', stage: 'completed' }
    ],
    ['show', TaskShowParams, { taskId: 't' }, { taskId: '' }],
    [
      'cancel',
      TaskCancelParams,
      { taskId: 't', rationale: 'User authorized cancellation' },
      { taskId: 't', rationale: '' }
    ],
    ['create', TaskCreateParams, create, { ...create, replanLevel: 'MAJOR_REPLAN' }]
  ])('%s accepts valid and rejects invalid params', (_, schema, valid, invalid) => {
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse(invalid).success).toBe(false)
  })
  it('accepts a FIX_TASK and defaults missing edge thresholds', () => {
    const parsed = TaskCreateParams.parse({
      ...create,
      spec: { ...create.spec, kind: 'fix' },
      edges: [{ fromTaskId: 't', toTaskId: 'T01' }]
    })
    expect(parsed.edges[0].readinessThreshold).toBe('INTEGRATED')
    expect(TaskListParams.safeParse({ missionId: 'm' }).success).toBe(true)
  })
  it('keeps authoritative stage distinct from the Orca execution projection', () => {
    const item = {
      id: 't',
      missionId: 'm',
      planRevisionId: 'p',
      title: 'Task',
      stage: 'SUBMITTED',
      orcaStatus: 'completed'
    }
    expect(TaskListItemSchema.safeParse(item).success).toBe(true)
    expect(
      TaskListItemSchema.safeParse({ ...item, stage: 'BLOCKED', previousStage: 'VERIFYING' })
        .success
    ).toBe(true)
    expect(TaskListItemSchema.safeParse({ ...item, stage: 'completed' }).success).toBe(false)
    expect(TaskListItemSchema.safeParse({ ...item, orcaStatus: 'INTEGRATED' }).success).toBe(false)
  })
})
