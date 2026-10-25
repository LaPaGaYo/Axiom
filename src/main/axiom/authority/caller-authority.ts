import type { RpcContext } from '../../runtime/rpc/core'
import type { RpcMethodPermission } from '../../runtime/rpc/rpc-method-permission'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { getAxiomControlPlane } from '../control-plane'

type CallerClass = 'desktop_only' | 'attempt' | 'read'

export const AXIOM_METHOD_CALLER_CLASS: Record<string, CallerClass> = {
  'axiom.namespace.get': 'read',
  'axiom.mission.create': 'desktop_only',
  'axiom.mission.plan': 'desktop_only',
  'axiom.mission.start': 'desktop_only',
  'axiom.mission.pause': 'desktop_only',
  'axiom.mission.resume': 'desktop_only',
  'axiom.mission.cancel': 'desktop_only',
  'axiom.goal.propose': 'desktop_only',
  'axiom.goal.activate': 'desktop_only',
  'axiom.plan.approve': 'desktop_only',
  'axiom.plan.reject': 'desktop_only',
  'axiom.policy.update': 'desktop_only',
  'axiom.task.create': 'desktop_only',
  'axiom.task.cancel': 'desktop_only',
  'axiom.message.answer': 'desktop_only',
  'axiom.message.resolve': 'desktop_only',
  'axiom.attempt.submit': 'attempt',
  'axiom.attempt.ask': 'attempt',
  'axiom.attempt.inform': 'attempt',
  'axiom.attempt.request': 'attempt',
  'axiom.attempt.blocked': 'attempt',
  'axiom.attempt.handoff': 'attempt',
  'axiom.attempt.request-subtask': 'attempt',
  'axiom.attempt.check': 'attempt',
  'axiom.plan.propose': 'attempt',
  'axiom.artifact.put': 'attempt',
  'axiom.artifact.read': 'read',
  'axiom.artifact.list': 'read',
  'axiom.attempt.show': 'read',
  'axiom.attempt.list': 'read',
  'axiom.goal.show': 'read',
  'axiom.message.list': 'read',
  'axiom.mission.show': 'read',
  'axiom.mission.list': 'read',
  'axiom.plan.show': 'read',
  'axiom.plan.list': 'read',
  'axiom.policy.show': 'read',
  'axiom.task.list': 'read',
  'axiom.task.show': 'read',
  'axiom.verification.show': 'read',
  'axiom.verification.list': 'read'
}

export function resolveAxiomCallerClass(method: string, params: unknown): CallerClass | undefined {
  if (method === 'axiom.plan.propose' || method === 'axiom.artifact.put') {
    return params &&
      typeof params === 'object' &&
      'attemptId' in params &&
      params.attemptId !== undefined
      ? 'attempt'
      : 'desktop_only'
  }
  return Object.hasOwn(AXIOM_METHOD_CALLER_CLASS, method)
    ? AXIOM_METHOD_CALLER_CLASS[method]
    : undefined
}

const AGENT_FORBIDDEN_METHODS = new Set([
  'agentSession.respondToApproval',
  'agentSession.respondToQuestion',
  'orchestration.runCreate',
  'orchestration.dispatch',
  'orchestration.workerStart',
  'orchestration.taskCreate'
])

/** Transport identity is the boundary; the host-resolved session only adds a misuse guard. */
export function assertAxiomCallerAuthority(
  method: string,
  params: unknown,
  ctx: RpcContext,
  permission: RpcMethodPermission
): void {
  const desktopRefused =
    resolveAxiomCallerClass(method, params) === 'desktop_only' && ctx.caller?.kind !== 'desktop'
  const agentRestricted = permission !== 'workspace' || AGENT_FORBIDDEN_METHODS.has(method)
  if (!desktopRefused && !agentRestricted) {
    return
  }

  // Never infer a session from params or an unverified environment claim.
  const caller = ctx.orchestrationCaller
  const dispatch = caller
    ? ctx.runtime
        .getOrchestrationDb()
        .getActiveDispatchForIdentity(caller.address, caller.paneKey ?? undefined)
    : undefined
  const store = dispatch ? getAxiomControlPlane(ctx.runtime).store : undefined
  const binding = dispatch ? store?.getAttemptBindingByDispatch(dispatch.id) : undefined
  if (!desktopRefused && !binding) {
    return
  }
  if (binding && store && dispatch) {
    store.appendAuditEvent({
      missionId: binding.missionId,
      actor: 'CallerAuthority',
      objectKind: 'task',
      objectId: binding.taskId,
      event: 'authority.refused',
      before: null,
      after: { method, callerKind: ctx.caller?.kind ?? 'unknown', attemptId: dispatch.id }
    })
  }
  throw new OrchestrationError(
    desktopRefused ? 'caller_not_desktop' : 'caller_not_permitted_for_agent',
    desktopRefused
      ? 'Make this decision in the Axiom app; human actions are not accepted from the CLI or an agent session.'
      : 'This action is not permitted from a Mission agent session.'
  )
}
