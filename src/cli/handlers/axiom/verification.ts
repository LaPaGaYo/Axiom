import type { CommandHandler } from '../../dispatch'
import { getRequiredStringFlag as required, getOptionalStringFlag as optional } from '../../flags'
import { formatVerificationRun, formatVerificationRunList } from '../../axiom-format'
import { callAxiom } from './rpc-command'

export const AXIOM_VERIFICATION_HANDLERS: Record<string, CommandHandler> = {
  'verification show': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.verification.show',
      { runId: required(ctx.flags, 'run') },
      formatVerificationRun
    )
  },
  'verification list': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.verification.list',
      {
        missionId: required(ctx.flags, 'mission'),
        taskId: optional(ctx.flags, 'task'),
        candidateId: optional(ctx.flags, 'candidate'),
        status: optional(ctx.flags, 'status')
      },
      formatVerificationRunList
    )
  }
}
