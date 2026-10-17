import type { CommandHandler } from '../../dispatch'
import { getRequiredStringFlag as required, getOptionalStringFlag as optional } from '../../flags'
import {
  AttemptResponseSchema,
  AttemptListResponseSchema,
  type AttemptSummary
} from '../../../shared/axiom-contract/attempt-params'
import { callAxiom } from './rpc-command'
const formatAttempt = (a: AttemptSummary) =>
  `${a.attemptId ?? `${a.taskId}/${a.seq}`}  ${a.state}  ${a.liveness ?? 'pending'}  ${a.branch}`
export const AXIOM_ATTEMPT_HANDLERS: Record<string, CommandHandler> = {
  'attempt show': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.attempt.show',
      { attemptId: required(ctx.flags, 'attempt') },
      (value) => formatAttempt(AttemptResponseSchema.parse(value).attempt)
    )
  },
  'attempt list': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.attempt.list',
      { missionId: required(ctx.flags, 'mission'), taskId: optional(ctx.flags, 'task') },
      (value) => AttemptListResponseSchema.parse(value).attempts.map(formatAttempt).join('\n')
    )
  }
}
