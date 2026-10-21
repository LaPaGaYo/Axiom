import * as integrationBase from './execution/integration-base'
import * as detection from '../preflight/agent-detection'
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

export function rpcFixture(dbPath = ':memory:') {
  vi.spyOn(integrationBase, 'ensureIntegrationBase').mockResolvedValue({
    sha: 'fixture-head',
    created: true
  })
  vi.spyOn(detection, 'detectInstalledAgentsWithShellPathHydration').mockResolvedValue([])
  const db = new OrchestrationDb(dbPath)
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'listManagedWorktrees').mockResolvedValue({
    worktrees: [],
    totalCount: 0,
    truncated: false
  })
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
