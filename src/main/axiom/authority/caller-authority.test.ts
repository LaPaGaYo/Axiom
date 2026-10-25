import { afterEach, expect, it, vi } from 'vitest'
import { AXIOM_METHODS } from '../../runtime/rpc/methods/axiom'
import { AXIOM_ATTEMPT_CALLER_METHODS } from '../../../shared/axiom-contract/attempt-caller-methods'
import type { RpcContext } from '../../runtime/rpc/core'
import { RPC_METHOD_PERMISSIONS } from '../../runtime/rpc/rpc-method-permission'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import {
  AXIOM_METHOD_CALLER_CLASS,
  assertAxiomCallerAuthority,
  resolveAxiomCallerClass
} from './caller-authority'

afterEach(() => vi.restoreAllMocks())
it('classifies exactly every registered Axiom method, including namespace discovery', () => {
  expect(Object.keys(AXIOM_METHOD_CALLER_CLASS).sort()).toEqual(
    AXIOM_METHODS.map((m) => m.name).sort()
  )
  for (const method of AXIOM_ATTEMPT_CALLER_METHODS) {
    expect(resolveAxiomCallerClass(method, { attemptId: 'attempt-1' })).toBe('attempt')
  }
})
it.each(['axiom.plan.propose', 'axiom.artifact.put'])(
  '%s selects authority by attemptId',
  (method) => {
    expect(resolveAxiomCallerClass(method, {})).toBe('desktop_only')
    expect(resolveAxiomCallerClass(method, { attemptId: undefined })).toBe('desktop_only')
    expect(resolveAxiomCallerClass(method, { attemptId: 'attempt-1' })).toBe('attempt')
  }
)
it('audits a host-resolved Attempt refusal and leaves unidentified callers unaudited', () => {
  const f = channelFixture()
  try {
    const sessionId = testOrcaSessionId('4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37')
    const ctx: RpcContext = {
      runtime: f.runtime,
      caller: { kind: 'local-cli' },
      orchestrationCaller: {
        address: f.t01.from,
        terminalHandle: f.t01.from,
        paneKey: f.t01.paneKey,
        sessionId,
        orcaSessionId: sessionId,
        workspaceId: 'repo::T01'
      }
    }
    const audits = () =>
      f.store
        .listAuditEvents({ missionId: f.mission.id })
        .filter((row) => row.event === 'authority.refused')
    expect(() => assertAxiomCallerAuthority('axiom.plan.approve', {}, ctx, 'workspace')).toThrow(
      expect.objectContaining({ code: 'caller_not_desktop' })
    )
    expect(audits()).toMatchObject([
      {
        objectKind: 'task',
        objectId: f.t01.taskId,
        after: {
          method: 'axiom.plan.approve',
          callerKind: 'local-cli',
          attemptId: f.t01.attemptId
        }
      }
    ])
    for (const permission of RPC_METHOD_PERMISSIONS.filter((p) => p !== 'workspace')) {
      expect(() => assertAxiomCallerAuthority('test.admin', {}, ctx, permission)).toThrow(
        expect.objectContaining({ code: 'caller_not_permitted_for_agent' })
      )
    }
    for (const method of [
      'agentSession.respondToApproval',
      'agentSession.respondToQuestion',
      'orchestration.runCreate',
      'orchestration.dispatch',
      'orchestration.workerStart',
      'orchestration.taskCreate'
    ]) {
      expect(() => assertAxiomCallerAuthority(method, {}, ctx, 'workspace')).toThrow(
        expect.objectContaining({ code: 'caller_not_permitted_for_agent' })
      )
    }
    expect(() => assertAxiomCallerAuthority('axiom.task.show', {}, ctx, 'workspace')).not.toThrow()
    const before = audits()
    expect(() =>
      assertAxiomCallerAuthority(
        'axiom.plan.approve',
        { attemptId: f.t01.attemptId },
        { ...ctx, orchestrationCaller: undefined },
        'workspace'
      )
    ).toThrow(expect.objectContaining({ code: 'caller_not_desktop' }))
    expect(audits()).toEqual(before)
    const ordinary = {
      ...ctx,
      orchestrationCaller: { ...ctx.orchestrationCaller!, address: 'unmanaged', paneKey: null }
    }
    expect(() =>
      assertAxiomCallerAuthority('agentSession.respondToApproval', {}, ordinary, 'workspace')
    ).not.toThrow()
    expect(() => assertAxiomCallerAuthority('test.admin', {}, ordinary, 'host-admin')).not.toThrow()
    expect(audits()).toEqual(before)
  } finally {
    f.db.close()
  }
})
