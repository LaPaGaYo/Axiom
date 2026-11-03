import { describe, expect, it } from 'vitest'
import {
  TaskCancelParams,
  TaskAdjustParams,
  TaskCreateParams,
  TaskListItemSchema,
  TaskListParams,
  TaskShowParams
} from './task-params'
import { makeProposal, provenance } from './contract-fixtures.test-support'

const create = {
  missionId: 'm',
  task: makeProposal().tasks[0],
  dependsOn: [],
  provenance
}
describe('axiom.task params', () => {
  it('accepts rationale-only adjustment and bounded explicit scope and retry additions', () => {
    expect(TaskAdjustParams.parse({ taskId: 't', rationale: 'Reviewed' })).toEqual({
      taskId: 't',
      rationale: 'Reviewed',
      addAllowedPaths: []
    })
    expect(
      TaskAdjustParams.parse({
        taskId: 't',
        rationale: 'Reviewed',
        addAllowedPaths: [' src/check.ts '],
        maxAttempts: 3
      })
    ).toMatchObject({ addAllowedPaths: ['src/check.ts'], maxAttempts: 3 })
    for (const extra of [
      { rationale: '' },
      { addAllowedPaths: [' '] },
      { addAllowedPaths: Array(51).fill('src/check.ts') },
      { maxAttempts: 0 },
      { maxAttempts: 1.5 },
      { stage: 'READY' }
    ]) {
      expect(
        TaskAdjustParams.safeParse({ taskId: 't', rationale: 'Reviewed', ...extra }).success
      ).toBe(false)
    }
  })
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
  it('accepts a FIX_TASK and defaults omitted dependencies to an empty root set', () => {
    const parsed = TaskCreateParams.parse({
      ...create,
      task: { ...create.task, kind: 'fix' },
      dependsOn: undefined
    })
    expect(parsed.dependsOn).toEqual([])
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
