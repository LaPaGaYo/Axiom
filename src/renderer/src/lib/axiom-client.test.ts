import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axiomClient, AxiomRpcError } from './axiom-client'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import {
  goal,
  mission,
  policy,
  attempt,
  message
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
