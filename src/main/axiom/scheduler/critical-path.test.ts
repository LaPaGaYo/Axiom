import { afterEach, expect, it } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { orderByCriticalPath } from './critical-path'

const f = planned(fixture())
afterEach(() => f.db.close())

it('prioritizes path length before lexical id and memoizes the frozen DAG fan-in', () => {
  f.controller.startExecution(f.missionId)
  const tasks = f.store.listTaskStages({ missionId: f.missionId })
  // Relabel the same frozen graph so the shortest root sorts first lexically.
  const ids = new Map(
    tasks.map((t) => [
      t.taskId,
      t.spec.id === 'T03' ? 'a-short' : t.spec.id === 'T02' ? 'b-long' : `z-${t.spec.id}`
    ])
  )
  const edges = f.store
    .listTaskEdges(f.missionId)
    .map((edge) => ({
      ...edge,
      fromTaskId: ids.get(edge.fromTaskId)!,
      toTaskId: ids.get(edge.toTaskId)!
    }))
  const ready = tasks
    .filter((t) => t.stage === 'READY')
    .map((t) => ({ ...t, taskId: ids.get(t.taskId)! }))
    .toReversed()
  const reads: string[] = []
  const ordered = orderByCriticalPath(
    {
      listDownstreamEdges(taskId) {
        reads.push(taskId)
        return edges.filter((e) => e.fromTaskId === taskId)
      }
    },
    ready
  )
  expect(ordered.map((t) => t.taskId)).toEqual(['b-long', 'z-T01', 'a-short'])
  expect(reads).toHaveLength(12)
  expect(new Set(reads).size).toBe(12)
  expect(ready.map((t) => t.taskId)).not.toEqual(ordered.map((t) => t.taskId))
})
