import { readTaskFile } from './input-files'
import type { CommandHandler } from '../../dispatch'
import {
  getRequiredStringFlag as required,
  getRepeatedStringFlag as repeated,
  getOptionalStringFlag as optional
} from '../../flags'
import { formatTask, formatTaskList } from '../../axiom-format'
import { callAxiom } from './rpc-command'

export const AXIOM_TASK_HANDLERS: Record<string, CommandHandler> = {
  'task create': async (ctx) => {
    const input = await readTaskFile(ctx.cwd, required(ctx.flags, 'file'))
    await callAxiom(
      ctx,
      'axiom.task.create',
      {
        ...input,
        missionId: required(ctx.flags, 'mission'),
        dependsOn: repeated(ctx.flags, 'depends-on')
      },
      formatTask
    )
  },
  'task list': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.task.list',
      { missionId: required(ctx.flags, 'mission'), stage: optional(ctx.flags, 'stage') },
      formatTaskList
    )
  },
  'task show': async (ctx) => {
    await callAxiom(ctx, 'axiom.task.show', { taskId: required(ctx.flags, 'task') }, formatTask)
  },
  'task cancel': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.task.cancel',
      { taskId: required(ctx.flags, 'task'), rationale: required(ctx.flags, 'rationale') },
      formatTask
    )
  }
}
