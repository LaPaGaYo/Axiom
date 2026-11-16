import { expect, it } from 'vitest'
import { rejectedPlanRevisions } from './rejected-plan-revisions'

it('bounds the Task list of a rejected plan revision', () => {
  const tasks = Array.from({ length: 60 }, (_, index) => ({
    id: `id-${String(index).padStart(3, '0')}`,
    title: 't'.repeat(100)
  }))
  const revision = {
    revision: 1,
    status: 'REJECTED',
    goalRevisionId: 'active-goal',
    tasks,
    rejectedReason: 'Keep the scope small.'
  }
  const content = rejectedPlanRevisions([revision], 'active-goal')
  expect(content).toBeDefined()
  const entries = content!.split('Revision 1 Tasks (id: title): ')[1].split('; ')
  expect(entries.at(-1)).toBe('(51 more Tasks omitted)')
  expect(entries.slice(0, -1)).toEqual(
    tasks.slice(0, 9).map((task) => `${JSON.stringify(task.id)}: ${JSON.stringify(task.title)}`)
  )
  const displayed = entries.slice(0, -1).join('; ')
  expect(Buffer.byteLength(displayed)).toBeLessThanOrEqual(1024)
  expect(
    Buffer.byteLength(
      `${displayed}; ${JSON.stringify(tasks[9].id)}: ${JSON.stringify(tasks[9].title)}`
    )
  ).toBeGreaterThan(1024)

  const oversized = rejectedPlanRevisions(
    [{ ...revision, tasks: [{ id: 'i'.repeat(128), title: '界'.repeat(500) }, tasks[0]] }],
    'active-goal'
  )
  expect(oversized?.split('Revision 1 Tasks (id: title): ')[1]).toBe('(2 more Tasks omitted)')
  const fitting = rejectedPlanRevisions([{ ...revision, tasks: tasks.slice(0, 2) }], 'active-goal')
  expect(fitting?.split('Revision 1 Tasks (id: title): ')[1]).toBe(entries.slice(0, 2).join('; '))
  expect(fitting).not.toContain('more Tasks omitted')
})
