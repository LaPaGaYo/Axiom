import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { RpcRequest } from '../runtime/rpc/core'
import { AXIOM_METHODS } from '../runtime/rpc/methods/axiom'
import { AxiomStore } from './db/axiom-store'
import { goal, policy } from '../../shared/axiom-contract/contract-fixtures.test-support'

export const createParams = { repo: 'fixture', targetBranch: 'main', goal, policy }

export function rpcFixture() {
  const db = new OrchestrationDb(':memory:')
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'showRepo').mockResolvedValue({
    id: 'repo-fixture',
    path: '/fixture',
    displayName: 'fixture',
    badgeColor: '',
    addedAt: 0
  })
  const dispatcher = new RpcDispatcher({ runtime, methods: AXIOM_METHODS })
  const call = (method: string, params: unknown, envelope: Partial<RpcRequest> = {}) =>
    dispatcher.dispatch({
      id: randomUUID(),
      authToken: 'test-caller',
      method,
      params,
      orchestrationContractVersion: 1,
      orchestrationRequestId: randomUUID(),
      ...envelope
    })
  return { db, runtime, dispatcher, store: new AxiomStore(db), call }
}
