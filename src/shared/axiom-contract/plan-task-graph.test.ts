import { describe, expect, it } from 'vitest'
import { orderPlanTasks } from './plan-task-graph'
import type { TaskEdge } from './mission-objects'

function edge(fromTaskId: string, toTaskId: string): TaskEdge {
  return { fromTaskId, toTaskId, readinessThreshold: 'INTEGRATED' }
}

describe('plan task graph', () => {
  it('handles an empty graph and isolated tasks', () => {
    expect(orderPlanTasks([], [])).toEqual({ order: [], roots: [], cycle: [] })
    expect(orderPlanTasks(['b', 'a'], [])).toEqual({
      order: ['a', 'b'],
      roots: ['a', 'b'],
      cycle: []
    })
  })
  it('finds a disconnected cycle after exhausting an acyclic component', () => {
    const graph = orderPlanTasks(
      ['e', 'd', 'c', 'b', 'a'],
      [edge('a', 'b'), edge('c', 'd'), edge('d', 'e'), edge('e', 'c')]
    )
    expect(graph).toEqual({ order: ['a', 'b'], roots: ['a'], cycle: ['c', 'd', 'e'] })
  })
  it('orders shared descendants once and returns only actual cycle members', () => {
    expect(
      orderPlanTasks(
        ['a', 'b', 'c', 'd'],
        [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]
      )
    ).toEqual({ order: ['a', 'b', 'c', 'd'], roots: ['a'], cycle: [] })
    expect(
      orderPlanTasks(
        ['a', 'b', 'c', 'd'],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'b'), edge('c', 'd')]
      ).cycle
    ).toEqual(['b', 'c'])
  })
})
