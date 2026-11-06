import { readTaskFile } from './input-files'
import type { CommandHandler } from '../../dispatch'
import {
  getRequiredStringFlag as required,
  getRepeatedStringFlag as repeated,
  getOptionalStringFlag as optional,
  getOptionalPositiveIntegerFlag
} from '../../flags'
import { formatTask, formatTaskList } from '../../axiom-format'
import { callAxiom } from './rpc-command'
import { acceptanceFromFlags } from './acceptance-flags'

export const AXIOM_TASK_HANDLERS: Record<string, CommandHandler> = {
  'task adjust': async (ctx) => {
    const acceptanceCriteria = acceptanceFromFlags(
      repeated(ctx.flags, 'acceptance'),
      repeated(ctx.flags, 'evidence'),
      repeated(ctx.flags, 'acceptance-artifact')
    )
    await callAxiom(
      ctx,
      'axiom.task.adjust',
      {
        taskId: required(ctx.flags, 'task'),
        rationale: required(ctx.flags, 'rationale'),
        addAllowedPaths: repeated(ctx.flags, 'add-path'),
        maxAttempts: getOptionalPositiveIntegerFlag(ctx.flags, 'max-attempts'),
        ...(acceptanceCriteria.length ? { acceptanceCriteria } : {})
      },
      formatTask
    )
  },
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
