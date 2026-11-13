import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { TaskStage } from '../../../shared/axiom-contract/lifecycle'
import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import { getAxiomControlPlane, taskListItem } from '../control-plane'
import { MissionControllerError } from '../mission-controller/controller-context'
import { createWaitingContext, type WaitingContext } from './waiting-context'
import { taskWaitingOn } from './task-waiting-on'

function taskView(ctx: WaitingContext, task: TaskStageRecord) {
  const orca = ctx.db.getTask(task.taskId)
  if (!orca || orca.run_id !== ctx.mission.runId) {
    throw new MissionControllerError('task_not_found', {
      taskId: task.taskId,
      missionId: task.missionId
    })
  }
  return {
    ...taskListItem({
      ...task,
      orcaStatus: orca.status,
      title: orca.task_title ?? task.spec.title
    }),
    waitingOn: taskWaitingOn(ctx, task)
  }
}

export function taskList(
  runtime: OrcaRuntimeService,
  input: { missionId: string; stage?: TaskStage },
  clock: () => string
) {
  const ctx = createWaitingContext(
    getAxiomControlPlane(runtime).store,
    runtime.getOrchestrationDb(),
    input.missionId,
    clock
  )
  return {
    tasks: ctx.tasks
      .filter((task) => !input.stage || task.stage === input.stage)
      .map((task) => taskView(ctx, task))
  }
}

export function taskShow(
  runtime: OrcaRuntimeService,
  input: { taskId: string },
  clock: () => string
) {
  const { store } = getAxiomControlPlane(runtime)
  const task = store.getTaskStage(input.taskId)
  if (!task) {
    throw new MissionControllerError('task_not_found', { taskId: input.taskId })
  }
  const ctx = createWaitingContext(store, runtime.getOrchestrationDb(), task.missionId, clock)
  return { task: taskView(ctx, task) }
}
