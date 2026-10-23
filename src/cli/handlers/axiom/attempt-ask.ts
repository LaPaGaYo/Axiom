import type { HandlerContext } from '../../dispatch'
import {
  getRequiredStringFlag as required,
  getOptionalStringFlag as optional,
  getRepeatedStringFlag as repeated,
  getOptionalNonNegativeIntegerFlag
} from '../../flags'
import { printResult } from '../../format'
import { AttemptAskResponseSchema } from '../../../shared/axiom-contract/attempt-params'
import { resolveOrchestrationAskClientTimeoutMs } from '../../../shared/orchestration-ask-timeout'
import { callOrchestrationMutation } from '../orchestration/mutation-request'
import { resolveOrchestrationTerminalHandle } from '../orchestration/terminal-identity'

export async function askAttempt(ctx: HandlerContext) {
  const { flags, cwd, client, json } = ctx
  const timeoutMs = getOptionalNonNegativeIntegerFlag(flags, 'timeout-ms')

  const result = await callOrchestrationMutation(
    client,
    flags,
    'axiom.attempt.ask',
    {
      attemptId: required(flags, 'attempt'),
      from: await resolveOrchestrationTerminalHandle(flags, cwd, client, 'from'),
      senderPaneKey: process.env.ORCA_PANE_KEY || undefined,
      question: optional(flags, 'question'),
      options: repeated(flags, 'option'),
      timeoutMs,
      resume: optional(flags, 'resume')
    },
    { timeoutMs: resolveOrchestrationAskClientTimeoutMs(timeoutMs) }
  )
  printResult(result, json, (value) => {
    const answer = AttemptAskResponseSchema.parse(value)
    return (
      answer.answer ??
      `${answer.messageId}  ${answer.cancelled ? 'cancelled' : answer.timedOut ? 'timed out' : 'pending'}`
    )
  })
}
