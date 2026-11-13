import { defineMethod } from '../../core'
import {
  TaskListParams,
  TaskCreateParams,
  TaskAdjustParams,
  TaskShowParams,
  TaskCancelParams
} from '../../../../../shared/axiom-contract/task-params'
import { getAxiomControlPlane, taskListItem } from '../../../../axiom/control-plane'
import { taskList, taskShow } from '../../../../axiom/read-models/task-reads'

export const AXIOM_TASK_METHODS = [
  defineMethod({
    name: 'axiom.task.adjust',
    permission: 'workspace',
    params: TaskAdjustParams,
    handler: (p, { runtime, recordMutationReceipt }) => {
      const { missions, store } = getAxiomControlPlane(runtime)
      return store.transaction('task_adjust_receipt', () => {
        const result = { task: taskListItem(missions.adjustTask({ ...p, actor: 'user' })) }
        recordMutationReceipt?.(result)
        return result
      })
    }
  }),
  defineMethod({
    name: 'axiom.task.create',
    permission: 'workspace',
    params: TaskCreateParams,
    handler: (p, { runtime, recordMutationReceipt }) => {
      const { missions, store } = getAxiomControlPlane(runtime)
      return store.transaction('task_create_receipt', () => {
        const result = { task: taskListItem(missions.createTask(p)) }
        recordMutationReceipt?.(result)
        return result
      })
    }
  }),
  defineMethod({
    name: 'axiom.task.list',
    permission: 'workspace',
    params: TaskListParams,
    handler: (p, { runtime }) => taskList(runtime, p, () => new Date().toISOString())
  }),
  defineMethod({
    name: 'axiom.task.show',
    permission: 'workspace',
    params: TaskShowParams,
    handler: (p, { runtime }) => taskShow(runtime, p, () => new Date().toISOString())
  }),
  defineMethod({
    name: 'axiom.task.cancel',
    permission: 'workspace',
    params: TaskCancelParams,
    handler: (p, { runtime }) => ({
      task: taskListItem(getAxiomControlPlane(runtime).missions.cancelTask({ ...p, actor: 'user' }))
    })
  })
]
