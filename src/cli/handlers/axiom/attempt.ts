import { askAttempt } from './attempt-ask'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CommandHandler, HandlerContext } from '../../dispatch'
import {
  getRequiredStringFlag as required,
  getOptionalStringFlag as optional,
  getRepeatedStringFlag as repeated,
  getOptionalNonNegativeIntegerFlag
} from '../../flags'
import { RuntimeClientError } from '../../runtime-client'
import { printResult } from '../../format'
import { callOrchestrationMutation } from '../orchestration/mutation-request'
import { resolveOrchestrationTerminalHandle } from '../orchestration/terminal-identity'
import { AttemptMessageResponseSchema } from '../../../shared/axiom-contract/message-params'
import { ORCHESTRATION_MESSAGE_WAIT_DEFAULT_TIMEOUT_MS } from '../../../shared/orchestration-message-wait-timeout'
import { MAX_TIMER_DELAY_MS } from '../../../shared/timer-delay'
import {
  AttemptResponseSchema,
  AttemptSubmitResponseSchema,
  AttemptListResponseSchema,
  AttemptCheckResponseSchema,
  type AttemptSummary
} from '../../../shared/axiom-contract/attempt-params'
import { SubmissionReportSchema } from '../../../shared/axiom-contract/submission-params'
import { callAxiom } from './rpc-command'
const formatAttempt = (a: AttemptSummary) =>
  `${a.attemptId ?? `${a.taskId}/${a.seq}`}  ${a.state}  ${a.liveness ?? 'pending'}  ${a.branch}`

async function sendWorkerMessage(ctx: HandlerContext, verb: string) {
  const { flags, client, cwd, json } = ctx
  const body = optional(flags, 'body')
  const bodyFile = optional(flags, 'body-file')
  if (body !== undefined && bodyFile !== undefined) {
    throw new RuntimeClientError('invalid_argument', 'Choose --body or --body-file, not both.')
  }
  const dependsOn = repeated(flags, 'depends-on')
  const orchestrationCapability = required(flags, 'dispatch-capability')
  const from = await resolveOrchestrationTerminalHandle(flags, cwd, client, 'from')
  const result = await callOrchestrationMutation(
    client,
    flags,
    `axiom.attempt.${verb}`,
    {
      attemptId: required(flags, 'attempt'),
      from,
      senderPaneKey: process.env.ORCA_PANE_KEY || undefined,
      summary: required(flags, 'summary'),
      body: bodyFile ? await readFile(path.resolve(cwd, bodyFile), 'utf8') : body,
      artifactIds: repeated(flags, 'artifact'),
      related: { taskIds: repeated(flags, 'related-task') },
      ...(verb === 'request-subtask'
        ? {
            subtask: {
              title: required(flags, 'title'),
              objective: required(flags, 'objective'),
              allowedPaths: repeated(flags, 'allowed-path'),
              acceptanceCriteria: repeated(flags, 'acceptance'),
              requiredEvidence: repeated(flags, 'evidence'),
              risk: optional(flags, 'risk') ?? 'low',
              ...(dependsOn.length ? { dependsOn } : {})
            }
          }
        : {})
    },
    { orchestrationCapability }
  )
  printResult(
    result,
    json,
    (value) => `Sent ${AttemptMessageResponseSchema.parse(value).message.id}`
  )
}

export const AXIOM_ATTEMPT_HANDLERS: Record<string, CommandHandler> = {
  'attempt submit': async ({ flags, cwd, client, json }) => {
    const orchestrationCapability = required(flags, 'dispatch-capability')
    const content = await readFile(path.resolve(cwd, required(flags, 'report')), 'utf8')
    let value: unknown
    try {
      value = JSON.parse(content)
    } catch {
      throw new RuntimeClientError('invalid_argument', 'Submission report must be valid JSON.')
    }
    const report = SubmissionReportSchema.safeParse(value)
    if (!report.success) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Submission report does not match axiom-submission-v1.'
      )
    }
    const from = await resolveOrchestrationTerminalHandle(flags, cwd, client, 'from')
    const result = await callOrchestrationMutation(
      client,
      flags,
      'axiom.attempt.submit',
      {
        attemptId: required(flags, 'attempt'),
        from,
        senderPaneKey: process.env.ORCA_PANE_KEY || undefined,
        report: report.data
      },
      { orchestrationCapability }
    )
    printResult(
      result,
      json,
      (value) => `Submitted ${AttemptSubmitResponseSchema.parse(value).submission.id}`
    )
  },
  'attempt ask': askAttempt,
  'attempt inform': (ctx) => sendWorkerMessage(ctx, 'inform'),
  'attempt request': (ctx) => sendWorkerMessage(ctx, 'request'),
  'attempt blocked': (ctx) => sendWorkerMessage(ctx, 'blocked'),
  'attempt handoff': (ctx) => sendWorkerMessage(ctx, 'handoff'),
  'attempt request-subtask': (ctx) => sendWorkerMessage(ctx, 'request-subtask'),
  'attempt check': async ({ flags, cwd, client, json }) => {
    const orchestrationCapability = required(flags, 'dispatch-capability')
    const from = await resolveOrchestrationTerminalHandle(flags, cwd, client, 'from')
    const wait = flags.has('wait') ? true : undefined
    const timeoutMs = getOptionalNonNegativeIntegerFlag(flags, 'timeout-ms')
    // RuntimeClient's generic long-poll widening only recognizes orchestration.check.
    const transportTimeout = wait
      ? (timeoutMs ?? ORCHESTRATION_MESSAGE_WAIT_DEFAULT_TIMEOUT_MS) + 10_000
      : undefined
    if (transportTimeout !== undefined && transportTimeout > MAX_TIMER_DELAY_MS) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--timeout-ms is too large for transport grace.'
      )
    }
    const result = await client.call(
      'axiom.attempt.check',
      {
        attemptId: required(flags, 'attempt'),
        from,
        senderPaneKey: process.env.ORCA_PANE_KEY || undefined,
        wait,
        timeoutMs,
        type: optional(flags, 'type')
      },
      {
        orchestrationCapability,
        ...(transportTimeout !== undefined ? { timeoutMs: transportTimeout } : {})
      }
    )
    printResult(
      result,
      json,
      (value) => `${AttemptCheckResponseSchema.parse(value).count} messages`
    )
  },
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
