import { expect, it } from 'vitest'
import { AXIOM_ATTEMPT_CALLER_METHODS } from '../../shared/axiom-contract/attempt-caller-methods'
import { AXIOM_MUTATION_METHODS } from '../../shared/axiom-contract/mutations'
import { orchestrationCallerEnvelope } from './orchestration-compatibility-envelope'

const compatibility = {
  compatibilityInvocationId: 'original',
  orchestrationCompatibilityEvidence: {
    agentSessionId: '4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37'
  }
}

// The host coverage test pins this union to exactly Attempt and desktop-only Axiom methods.
it.each([...new Set([...AXIOM_MUTATION_METHODS, ...AXIOM_ATTEMPT_CALLER_METHODS])])(
  'carries injected identity for %s without granting caller authority',
  (method) => {
    expect(orchestrationCallerEnvelope(method, compatibility, 'receipt')).toEqual({
      ...compatibility,
      compatibilityInvocationId: 'receipt'
    })
  }
)

it.each([
  'axiom.namespace.get',
  'axiom.artifact.read',
  'axiom.artifact.list',
  'axiom.attempt.show',
  'axiom.attempt.list',
  'axiom.goal.show',
  'axiom.message.list',
  'axiom.mission.show',
  'axiom.mission.list',
  'axiom.plan.show',
  'axiom.plan.list',
  'axiom.policy.show',
  'axiom.task.list',
  'axiom.task.show',
  'axiom.verification.show',
  'axiom.verification.list',
  'axiom.unregistered',
  'agentSession.respondToApproval',
  'agentSession.respondToQuestion',
  'settings.update',
  'terminal.list',
  'computer.click'
])('keeps %s outside CLI session attribution', (method) => {
  expect(orchestrationCallerEnvelope(method, compatibility, 'receipt')).toEqual({})
})

it.each(['orchestration.runShow', 'orchestration.reset', 'orchestration.workerStart'])(
  'preserves non-Axiom session attribution for %s',
  (method) => {
    expect(orchestrationCallerEnvelope(method, compatibility, undefined)).toEqual(compatibility)
  }
)
