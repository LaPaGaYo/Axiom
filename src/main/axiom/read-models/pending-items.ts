import { TERMINAL_TASK_STAGES } from '../../../shared/axiom-contract/lifecycle'
import {
  PENDING_ITEM_KINDS,
  type MissionPendingItem
} from '../../../shared/axiom-contract/mission-pending'
import { taskWaitingOn } from './task-waiting-on'
import { utcTimestamp, type WaitingContext } from './waiting-context'

export function createPendingItems(ctx: WaitingContext) {
  const waits = new Map(ctx.tasks.map((task) => [task.taskId, taskWaitingOn(ctx, task)]))
  const nonTerminal = new Set(
    ctx.tasks.filter((task) => !TERMINAL_TASK_STAGES.has(task.stage)).map((task) => task.taskId)
  )
  const counts = new Map<string, number>()
  function blocks(taskId: string): number {
    const cached = counts.get(taskId)
    if (cached !== undefined) {
      return cached
    }
    // ponytail: one DAG traversal per distinct blocking Task, O(T*(T+E)); batch reachability if Missions outgrow small plans.
    const visited = new Set<string>()
    const queue = [taskId]
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      if (visited.has(id)) {
        continue
      }
      visited.add(id)
      queue.push(...(ctx.downstream.get(id) ?? []))
    }
    const count = [...visited].filter((id) => nonTerminal.has(id)).length
    counts.set(taskId, count)
    return count
  }
  function item(input: Omit<MissionPendingItem, 'id' | 'blocks'>): MissionPendingItem {
    const waitingOn = input.taskId ? waits.get(input.taskId) : input.waitingOn
    return {
      ...input,
      id: `${input.kind}:${input.objectId}`,
      since: utcTimestamp(input.since),
      blocks: !input.blocking ? 0 : input.taskId ? blocks(input.taskId) : nonTerminal.size,
      ...(waitingOn ? { waitingOn } : {})
    }
  }
  return { waits, nonTerminal, item }
}

export type PendingItems = ReturnType<typeof createPendingItems>

export function comparePendingItems(a: MissionPendingItem, b: MissionPendingItem): number {
  return (
    Number(b.blocking) - Number(a.blocking) ||
    b.blocks - a.blocks ||
    PENDING_ITEM_KINDS.indexOf(a.kind) - PENDING_ITEM_KINDS.indexOf(b.kind) ||
    a.since.localeCompare(b.since) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}
