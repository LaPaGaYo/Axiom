import { expect, it } from 'vitest'
import { makeProposal } from './contract-fixtures.test-support'
import { scopeOverlaps } from './plan-overlap'
import type { TaskEdge } from './mission-objects'

function proposal(a: string[], b: string[], edges: TaskEdge[] = []) {
  return {
    tasks: makeProposal()
      .tasks.slice(0, 2)
      .map((task, i) => ({
        ...task,
        scope: { allowedPaths: i ? b : a }
      })),
    edges
  }
}

it.each([
  ['src', 'src/file.ts', true],
  ['src/file.ts', 'src', true],
  ['src', 'src-other/file.ts', false],
  ['src/file.ts', 'src/*.ts', true],
  ['src/*.ts', 'src/file.ts', true],
  ['src/a/file.ts', 'src/**/file.?s', true],
  ['src/*.ts', 'src/*.ts', true],
  ['src/**', 'src/*.ts', false],
  ['.', 'src/*.ts', true],
  ['src/**', '.', true],
  ['./src/', 'src/file.ts', true],
  ['../src', 'src', false]
])('overlap of %s and %s is %s', (a, b, overlaps) => {
  expect(scopeOverlaps(proposal([a], [b]))).toHaveLength(overlaps ? 1 : 0)
})

it('suppresses direct and transitive dependencies in either id direction', () => {
  for (const reverse of [false, true]) {
    const tasks = makeProposal()
      .tasks.slice(0, 3)
      .map((task) => ({
        ...task,
        scope: { allowedPaths: ['package.json'] }
      }))
    const ids = tasks.map((task) => task.id)
    if (reverse) {
      ids.reverse()
    }
    const edges = ids.slice(1).map((id, i) => ({
      fromTaskId: ids[i],
      toTaskId: id,
      readinessThreshold: 'INTEGRATED' as const
    }))
    expect(scopeOverlaps({ tasks, edges })).toEqual([])
  }
})

it('groups all matching entries per unordered pair in stable order', () => {
  const plan = proposal(['z.ts', 'a.ts', 'z.ts'], ['z.ts', 'a.ts'])
  const expected = [
    {
      code: 'scope_overlap',
      message: 'Parallel Tasks T01 and T02 have overlapping allowedPaths.',
      taskIds: ['T01', 'T02'],
      paths: [
        { a: 'a.ts', b: 'a.ts' },
        { a: 'z.ts', b: 'z.ts' }
      ]
    }
  ]
  expect(scopeOverlaps(plan)).toEqual(expected)
  expect(scopeOverlaps({ ...plan, tasks: plan.tasks.toReversed() })).toEqual(expected)
  const tasks = makeProposal()
    .tasks.slice(0, 3)
    .toReversed()
    .map((task) => ({
      ...task,
      scope: { allowedPaths: ['.'] }
    }))
  expect(scopeOverlaps({ tasks, edges: [] }).map((warning) => warning.taskIds)).toEqual([
    ['T01', 'T02'],
    ['T01', 'T03'],
    ['T02', 'T03']
  ])
})
