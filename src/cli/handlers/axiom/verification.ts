import type { CommandHandler } from '../../dispatch'
import { getRequiredStringFlag as required, getOptionalStringFlag as optional } from '../../flags'
import { REPEATED_FLAG_SEPARATOR } from '../../args'
import { formatVerificationRun, formatVerificationRunList } from '../../axiom-format'
import { callAxiom } from './rpc-command'
import { RuntimeClientError } from '../../runtime-client'

export const AXIOM_VERIFICATION_HANDLERS: Record<string, CommandHandler> = {
  'verification resolve': async (ctx) => {
    const verdict = required(ctx.flags, 'verdict')
    if (verdict !== 'PASS' && verdict !== 'FAIL') {
      throw new RuntimeClientError('invalid_argument', 'Verdict must be PASS or FAIL.')
    }
    const indices = ctx.flags.has('criterion')
      ? required(ctx.flags, 'criterion').split(REPEATED_FLAG_SEPARATOR)
      : []
    const criteria = indices.map((value) => {
      const index = Number(value)
      if (!value.trim() || !Number.isSafeInteger(index) || index < 0) {
        throw new RuntimeClientError(
          'invalid_argument',
          'Each --criterion must be a nonnegative integer.'
        )
      }
      return index
    })
    await callAxiom(
      ctx,
      'axiom.verification.resolve',
      {
        runId: required(ctx.flags, 'run'),
        verdict,
        rationale: required(ctx.flags, 'rationale'),
        criteria
      },
      () => `Verification resolved: ${verdict}`
    )
  },
  'verification rerun': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.verification.rerun',
      { taskId: required(ctx.flags, 'task'), rationale: required(ctx.flags, 'rationale') },
      () => 'Verification queued'
    )
  },
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
