import type { CommandHandler } from '../../dispatch'
import { getRequiredStringFlag as required, getOptionalStringFlag as optional } from '../../flags'
import { RuntimeClientError } from '../../runtime-client'
import { MessageListResponseSchema } from '../../../shared/axiom-contract/message-params'
import { callAxiom } from './rpc-command'

export const AXIOM_MESSAGE_HANDLERS: Record<string, CommandHandler> = {
  'message list': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.message.list',
      {
        missionId: required(ctx.flags, 'mission'),
        type: optional(ctx.flags, 'type'),
        pendingOnly: ctx.flags.has('pending') ? true : undefined
      },
      (value) =>
        MessageListResponseSchema.parse(value)
          .messages.map(
            (m) => `${m.id}  ${m.type}  ${m.pending ? 'pending' : 'resolved'}  ${m.summary}`
          )
          .join('\n')
    )
  },
  'message answer': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.message.answer',
      {
        missionId: required(ctx.flags, 'mission'),
        questionId: required(ctx.flags, 'question'),
        body: required(ctx.flags, 'body')
      },
      () => 'Question answered'
    )
  },
  'message resolve': async (ctx) => {
    if (ctx.flags.has('accept') === ctx.flags.has('reject')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Choose exactly one of --accept or --reject.'
      )
    }
    await callAxiom(
      ctx,
      'axiom.message.resolve',
      {
        missionId: required(ctx.flags, 'mission'),
        messageId: required(ctx.flags, 'message'),
        decision: ctx.flags.has('accept') ? 'accept' : 'reject',
        rationale: required(ctx.flags, 'rationale')
      },
      () => 'Subtask request resolved'
    )
  }
}
