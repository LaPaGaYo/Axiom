import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axiomClient, AxiomRpcError } from './axiom-client'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import {
  taskWithSpec,
  goal,
  mission,
  policy,
  attempt,
  message,
  verificationRun,
  missionUsage,
  reviewPendingItem,
  evidenceArtifact
} from '../../../shared/axiom-contract/contract-fixtures.test-support'

const call = vi.fn()
const success = (result: unknown) => ({
  id: 'desktop-ipc',
  ok: true,
  result,
  _meta: { runtimeId: 'r' }
})
const createParams = { repo: '/repo', targetBranch: 'main', goal, policy }
const created = {
  mission,
  goalRevision: { ...goal, id: 'g', missionId: mission.id, revision: 1, status: 'ACTIVE' },
  policy
}

beforeEach(() => {
  call.mockReset()
  vi.stubGlobal('window', { api: { runtime: { call } } })
})
afterEach(() => vi.unstubAllGlobals())

describe('Axiom desktop client', () => {
  it('reads a Task with its spec and sends an adjustment and a cancellation with the caller receipt id', async () => {
    const result = { task: taskWithSpec }
    call.mockResolvedValue(success(result))
    expect(await axiomClient.showTask({ taskId: taskWithSpec.id })).toEqual(result)
    expect(call).toHaveBeenLastCalledWith({
      method: 'axiom.task.show',
      params: { taskId: taskWithSpec.id }
    })
    const adjustment = {
      taskId: taskWithSpec.id,
      rationale: 'Reviewed',
      addAllowedPaths: ['src/test.ts'],
      maxAttempts: 3,
      maxTokens: 2000
    }
    const cancellation = { taskId: taskWithSpec.id, rationale: 'No longer needed' }
    for (const entry of [
      {
        method: 'axiom.task.adjust',
        params: adjustment,
        run: () => axiomClient.adjustTask(adjustment, 'adjust-receipt'),
        requestId: 'adjust-receipt'
      },
      {
        method: 'axiom.task.cancel',
        params: cancellation,
        run: () => axiomClient.cancelTask(cancellation, 'cancel-receipt'),
        requestId: 'cancel-receipt'
      }
    ]) {
      call.mockResolvedValue(success(result))
      expect(await entry.run()).toEqual(result)
      expect(call).toHaveBeenLastCalledWith({
        method: entry.method,
        params: entry.params,
        envelope: {
          orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
          orchestrationRequestId: entry.requestId
        }
      })
      call.mockResolvedValue(success({ task: { ...taskWithSpec, stage: 'done' } }))
      await expect(entry.run()).rejects.toMatchObject({ code: 'invalid_response' })
    }
    await expect(axiomClient.showTask({ taskId: taskWithSpec.id })).rejects.toMatchObject({
      code: 'invalid_response'
    })
    call.mockClear()
    await expect(axiomClient.adjustTask({ ...adjustment, maxTokens: 0 })).rejects.toMatchObject({
      code: 'invalid_params'
    })
    await expect(axiomClient.cancelTask({ ...cancellation, rationale: '' })).rejects.toMatchObject({
      code: 'invalid_params'
    })
    expect(call).not.toHaveBeenCalled()
  })
  it('sends a resolution and a rerun with the caller receipt id and reads the pending view', async () => {
    const pending = { missionId: mission.id, items: [reviewPendingItem] }
    call.mockResolvedValue(success(pending))
    expect(await axiomClient.missionPending({ missionId: mission.id })).toEqual(pending)
    expect(call).toHaveBeenLastCalledWith({
      method: 'axiom.mission.pending',
      params: { missionId: mission.id }
    })
    const resolution = {
      runId: verificationRun.id,
      verdict: 'PASS' as const,
      rationale: 'Reviewed',
      criteria: [1],
      disposition: 'intentional' as const
    }
    const rerun = { taskId: attempt.taskId, rationale: 'Try again' }
    for (const entry of [
      {
        method: 'axiom.verification.resolve',
        params: resolution,
        status: 'PASS',
        run: () => axiomClient.resolveVerification(resolution, 'resolve-receipt')
      },
      {
        method: 'axiom.verification.rerun',
        params: rerun,
        status: 'QUEUED',
        run: () => axiomClient.rerunVerification(rerun, 'rerun-receipt')
      }
    ]) {
      const result = { runId: verificationRun.id, status: entry.status }
      call.mockResolvedValue(success(result))
      expect(await entry.run()).toEqual(result)
      expect(call).toHaveBeenLastCalledWith({
        method: entry.method,
        params: entry.params,
        envelope: {
          orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
          orchestrationRequestId: entry.status === 'PASS' ? 'resolve-receipt' : 'rerun-receipt'
        }
      })
      call.mockResolvedValue(success({ ...result, status: 'HUMAN_REVIEW' }))
      await expect(entry.run()).rejects.toMatchObject({ code: 'invalid_response' })
    }
    call.mockResolvedValue(
      success({ ...pending, items: [{ ...reviewPendingItem, actions: ['unknown'] }] })
    )
    await expect(axiomClient.missionPending({ missionId: mission.id })).rejects.toMatchObject({
      code: 'invalid_response'
    })
    call.mockClear()
    await expect(
      axiomClient.resolveVerification({ ...resolution, rationale: ' ' })
    ).rejects.toMatchObject({ code: 'invalid_params' })
    await expect(axiomClient.rerunVerification({ ...rerun, rationale: ' ' })).rejects.toMatchObject(
      { code: 'invalid_params' }
    )
    expect(call).not.toHaveBeenCalled()
  })
  it('parses runs, usage and an Artifact with the contract schemas', async () => {
    const reads = [
      {
        method: 'axiom.verification.list',
        params: { missionId: mission.id, taskId: attempt.taskId },
        result: { runs: [verificationRun] },
        invalid: { runs: [{ ...verificationRun, status: 'done' }] },
        read: () =>
          axiomClient.listVerificationRuns({ missionId: mission.id, taskId: attempt.taskId })
      },
      {
        method: 'axiom.mission.usage',
        params: { missionId: mission.id, taskId: attempt.taskId },
        result: missionUsage,
        invalid: { ...missionUsage, used: -1 },
        read: () => axiomClient.missionUsage({ missionId: mission.id, taskId: attempt.taskId })
      },
      {
        method: 'axiom.artifact.read',
        params: { id: evidenceArtifact.meta.id },
        result: evidenceArtifact,
        invalid: { ...evidenceArtifact, contentBase64: 'invalid' },
        read: () => axiomClient.readArtifact({ id: evidenceArtifact.meta.id })
      }
    ]
    for (const entry of reads) {
      call.mockResolvedValue(success(entry.result))
      expect(await entry.read()).toEqual(entry.result)
      expect(call).toHaveBeenLastCalledWith({ method: entry.method, params: entry.params })
      call.mockResolvedValue(success(entry.invalid))
      await expect(entry.read()).rejects.toMatchObject({ code: 'invalid_response' })
    }
    call.mockClear()
    await expect(axiomClient.readArtifact({ id: '' })).rejects.toMatchObject({
      code: 'invalid_params'
    })
    expect(call).not.toHaveBeenCalled()
  })
  it('validates Attempt and message reads without a mutation envelope', async () => {
    call.mockResolvedValue(success({ attempts: [attempt] }))
    expect(
      await axiomClient.listAttempts({ missionId: mission.id, taskId: attempt.taskId })
    ).toEqual({ attempts: [attempt] })
    call.mockResolvedValue(success({ attempt }))
    expect(await axiomClient.showAttempt({ attemptId: attempt.attemptId })).toEqual({ attempt })
    call.mockResolvedValue(success({ messages: [message] }))
    expect(await axiomClient.listMessages({ missionId: mission.id, pendingOnly: true })).toEqual({
      messages: [message]
    })
    expect(call.mock.calls.every(([args]) => args.envelope === undefined)).toBe(true)
    call.mockResolvedValue(success({ attempt: { ...attempt, role: 'coordinator' } }))
    await expect(axiomClient.showAttempt({ attemptId: attempt.attemptId })).rejects.toMatchObject({
      code: 'invalid_response'
    })
  })
  it('stamps Planner, answer and resolution actions with the caller receipt id', async () => {
    call.mockResolvedValue(success({ attempt }))
    await axiomClient.planMission({ missionId: mission.id }, 'plan-action')
    call.mockResolvedValue(
      success({
        question: { message_id: message.id, status: 'answered' },
        message: { id: 'answer-1' },
        duplicate: false
      })
    )
    await axiomClient.answerMessage(
      { missionId: mission.id, questionId: message.id, body: 'Use A' },
      'answer-action'
    )
    call.mockResolvedValue(success({ resolved: true, decision: 'reject', reason: 'Out of scope' }))
    await axiomClient.resolveMessage(
      {
        missionId: mission.id,
        messageId: message.id,
        decision: 'reject',
        rationale: 'Out of scope'
      },
      'resolve-action'
    )
    expect(call.mock.calls.map(([args]) => [args.method, args.envelope])).toEqual(
      [
        ['plan', 'plan-action'],
        ['answer', 'answer-action'],
        ['resolve', 'resolve-action']
      ].map(([verb, id]) => [
        verb === 'plan' ? 'axiom.mission.plan' : `axiom.message.${verb}`,
        { orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION, orchestrationRequestId: id }
      ])
    )
  })
  it('stamps mutations, reuses an explicit action id, and leaves reads unstamped', async () => {
    call.mockResolvedValue(success(created))
    await axiomClient.createMission(createParams, 'action-1')
    await axiomClient.createMission(createParams, 'action-1')
    expect(call.mock.calls[0][0]).toMatchObject({
      method: 'axiom.mission.create',
      envelope: {
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        orchestrationRequestId: 'action-1'
      }
    })
    expect(call.mock.calls[1][0]).toEqual(call.mock.calls[0][0])
    call.mockResolvedValue(success({ mission }))
    await axiomClient.showMission({ missionId: mission.id })
    expect(call.mock.calls[2][0]).not.toHaveProperty('envelope')
  })
  it('mints a different id for each new action', async () => {
    call.mockResolvedValue(success({ mission }))
    await axiomClient.startMission({ missionId: mission.id })
    await axiomClient.startMission({ missionId: mission.id })
    const ids = call.mock.calls.map(([args]) => args.envelope.orchestrationRequestId)
    expect(ids[0]).toEqual(expect.any(String))
    expect(ids[0]).not.toBe(ids[1])
  })
  it.each([
    'plan_pending',
    'illegal_transition',
    'stale_state',
    'orchestration_migration_required'
  ])('preserves RPC code %s', async (code) => {
    call.mockResolvedValue({ id: 'desktop-ipc', ok: false, error: { code, message: 'Rejected' } })
    await expect(axiomClient.startMission({ missionId: mission.id })).rejects.toMatchObject({
      code,
      message: 'Rejected'
    })
  })
  it('rejects malformed responses and transport errors with one error type', async () => {
    call.mockResolvedValue(success({ tasks: [{ stage: 'completed' }] }))
    await expect(axiomClient.listTasks({ missionId: mission.id })).rejects.toMatchObject({
      code: 'invalid_response'
    })
    call.mockResolvedValue({ ok: true })
    await expect(axiomClient.listMissions()).rejects.toBeInstanceOf(AxiomRpcError)
    call.mockRejectedValue(new Error('offline'))
    await expect(axiomClient.listMissions()).rejects.toMatchObject({ code: 'transport_error' })
  })
  it('validates create input before sending', async () => {
    await expect(
      axiomClient.createMission({ ...createParams, targetBranch: '' })
    ).rejects.toMatchObject({ code: 'invalid_params' })
    expect(call).not.toHaveBeenCalled()
  })
})
