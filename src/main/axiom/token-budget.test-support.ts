import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { AxiomStore } from './db/axiom-store'
import { emptyTokenUsage } from '../../shared/axiom-contract/token-usage'

export function recordBudgetEvidence(name: string, value: unknown) {
  const directory = process.env.AXIOM_TOKEN_USAGE_EVIDENCE_DIRECTORY
  if (directory) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2))
  }
}

export function recordTokenSpend(
  ctx: { db: OrchestrationDb; store: AxiomStore },
  missionId: string,
  taskId: string,
  newTokens: number,
  final = true
) {
  const seq = ctx.store.nextAttemptSeq(taskId)
  const { dispatch } = ctx.db.createStartingWorkerDispatch({
    taskId,
    creator: { kind: 'system' },
    maxDepth: 1,
    startOptions: { channel: 'headless', agent: 'codex' }
  })
  ctx.store.insertAttemptBinding({
    missionId,
    taskId,
    seq,
    dispatchId: dispatch.id,
    branch: `axiom/attempt/${taskId}/${seq}`,
    agentSpecId: 'budget-test-spec',
    contextPackageId: 'budget-test-context'
  })
  ctx.db.failWorkerStart(dispatch.id, 'fixture', 'budget fixture ending')
  ctx.store.upsertAttemptTokenUsage({
    ...emptyTokenUsage('complete'),
    newTokens,
    inputTokens: newTokens,
    attemptId: dispatch.id,
    missionId,
    taskId,
    seq,
    provider: 'codex',
    final,
    measuredAt: '2026-11-12T12:00:00.000Z'
  })
  return dispatch.id
}
