import { defineMethod } from '../../core'
import {
  TaskListParams,
  TaskShowParams,
  TaskCancelParams
} from '../../../../../shared/axiom-contract/task-params'
import { getAxiomControlPlane, taskListItem } from '../../../../axiom/control-plane'

export const AXIOM_TASK_METHODS = [
  defineMethod({
    name: 'axiom.task.list',
    params: TaskListParams,
    handler: (p, { runtime }) => ({
      tasks: getAxiomControlPlane(runtime).missions.listTasks(p).map(taskListItem)
    })
  }),
  defineMethod({
    name: 'axiom.task.show',
    params: TaskShowParams,
    handler: (p, { runtime }) => ({
      task: taskListItem(getAxiomControlPlane(runtime).missions.getTask(p.taskId))
    })
  }),
  defineMethod({
    name: 'axiom.task.cancel',
    params: TaskCancelParams,
    handler: (p, { runtime }) => ({
      task: taskListItem(getAxiomControlPlane(runtime).missions.cancelTask({ ...p, actor: 'user' }))
    })
  })
]
