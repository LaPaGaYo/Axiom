import { z } from 'zod'
import { isAxiomAttemptCallerMethod } from '../../../shared/axiom-contract/attempt-caller-methods'
import type { RpcContext } from '../../runtime/rpc/core'
import { getAxiomControlPlane } from '../control-plane'
import { resolveAttemptSender } from './attempt-authority'

const CallerParams = z.object({ attemptId: z.string().optional(), from: z.string().optional() })

/** Receipt replay skips handlers, so validate the Attempt before the receipt executor as well. */
export function assertAttemptRequestAuthority(
  method: string,
  params: unknown,
  ctx: RpcContext
): void {
  if (!isAxiomAttemptCallerMethod(method)) {
    return
  }
  const caller = CallerParams.parse(params)
  if ((method === 'axiom.plan.propose' || method === 'axiom.artifact.put') && !caller.attemptId) {
    return
  }
  const input = {
    runtime: ctx.runtime,
    db: ctx.runtime.getOrchestrationDb(),
    store: getAxiomControlPlane(ctx.runtime).store,
    attemptId: caller.attemptId ?? '',
    from: ctx.orchestrationCaller?.address ?? caller.from ?? '',
    orchestrationCaller: ctx.orchestrationCaller,
    orchestrationCompatibilityEvidence: ctx.orchestrationCompatibilityEvidence,
    allowSubmissionReplay: method === 'axiom.attempt.submit'
  }
  if (method === 'axiom.plan.propose') {
    resolveAttemptSender({ ...input, role: 'planner' })
  } else {
    resolveAttemptSender(input)
  }
}
