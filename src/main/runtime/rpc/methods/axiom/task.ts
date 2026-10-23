import { defineMethod } from '../../core'
import {
  TaskListParams,
  TaskCreateParams,
  TaskShowParams,
  TaskCancelParams
} from '../../../../../shared/axiom-contract/task-params'
import { getAxiomControlPlane, taskListItem } from '../../../../axiom/control-plane'

export const AXIOM_TASK_METHODS = [
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
    handler: (p, { runtime }) => ({
      tasks: getAxiomControlPlane(runtime).missions.listTasks(p).map(taskListItem)
    })
  }),
  defineMethod({
    name: 'axiom.task.show',
    permission: 'workspace',
    params: TaskShowParams,
    handler: (p, { runtime }) => ({
      task: taskListItem(getAxiomControlPlane(runtime).missions.getTask(p.taskId))
    })
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
