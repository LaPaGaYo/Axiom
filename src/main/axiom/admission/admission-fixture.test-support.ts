import { randomUUID } from 'node:crypto'
import { expect, vi } from 'vitest'
import type { RpcRequest, RpcResponse } from '../../runtime/rpc/core'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import { ORCHESTRATION_METHODS } from '../../runtime/rpc/methods/orchestration'
import { createOrchestrationWorkerReleaseHarness } from '../../runtime/rpc/methods/orchestration/worker/worker-release.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { actor, createInput, propose } from '../mission-controller/controller-fixture.test-support'
import { provenance } from '../../../shared/axiom-contract/contract-fixtures.test-support'

export function admissionFixture(managed = true, bindTerminal = true) {
  const kernel = createOrchestrationWorkerReleaseHarness()
  kernel.setup()
  const { db, runtime } = kernel
  const { missions, store } = getAxiomControlPlane(runtime)
  let runId = kernel.activeRunId
  let missionId: string | undefined
  if (managed) {
    const created = missions.createMission(createInput)
    const plan = propose(missions, created.mission.id, created.goalRevision.id)
    missions.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance })
    missions.startExecution(created.mission.id)
    missionId = created.mission.id
    runId = created.mission.runId
    expect(missions.listTasks({ missionId })).toHaveLength(12)
    // Adversarial fixture: even a terminal already bound through the kernel is not the CP.
    // Production Mission Runs retain their synthetic session binding (D14).
    if (bindTerminal) {
      db.bindRun({
        runId,
        coordinatorHandle: 'term_coord',
        coordinatorPaneKey: kernel.coordinatorPaneKey
      })
    }
  } else {
    db.createTask({ spec: 'Plain Run task', runId })
  }
  const task = db.listTasks({ runId })[0]!
  vi.spyOn(runtime, 'cancelMessageWaiters').mockImplementation(() => {})
  vi.spyOn(runtime, 'stopOrchestrationFederationRelay').mockImplementation(() => {})
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS })
  const call = (verb: string, params: unknown, envelope: Partial<RpcRequest> = {}) =>
    dispatcher.dispatch({
      id: randomUUID(),
      authToken: 'test-caller',
      method: `orchestration.${verb}`,
      params,
      orchestrationContractVersion: 1,
      orchestrationRequestId: randomUUID(),
      ...envelope
    })
  // Compare full rows, not just counts: status, stage, generation and settlement must stay put.
  // Mutation receipts are deliberately excluded: the dispatcher records refusal evidence.
  const snapshot = () =>
    [
      'missions',
      'tasks',
      'task_stages',
      'dispatch_contexts',
      'worker_dispatches',
      'runs',
      'messages',
      'decision_gates',
      'mission_task_edges',
      'audit_events'
    ].map((table) => db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  const refusal = (response: RpcResponse, verb: string, ids: Record<string, string> = {}) => {
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'mission_managed',
        message: expect.stringContaining('No effects were applied.'),
        data: { missionId, runId, verb: `orchestration.${verb}`, ...ids }
      }
    })
  }
  return {
    ...kernel,
    db,
    runtime,
    store,
    missions,
    runId,
    missionId,
    task,
    call,
    snapshot,
    refusal
  }
}
