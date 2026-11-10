import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AttemptContinuePayloadSchema } from '../../../shared/axiom-contract/effects'
import type { z } from 'zod'
import { MissionController } from '../mission-controller/mission-controller'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { accountKey, readAccountCooldown } from './account-cooldown'

let f: ReturnType<typeof planned>
let root: string
const now = Date.parse('2026-11-10T12:00:00.000Z')
const until = '2026-11-10T12:01:00.000Z'
const homes = {
  claude: vi.fn(async (): Promise<string | null> => '/accounts/claude'),
  codex: vi.fn((): string | null => '/accounts/codex')
}
const view = () => readAccountCooldown(f.store, homes, () => now)
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'axiom-cooldown-'))
  f = planned(fixture(path.join(root, 'orchestration.db')))
  f.controller.startExecution(f.missionId)
  homes.claude.mockReset().mockResolvedValue('/accounts/claude')
  homes.codex.mockReset().mockReturnValue('/accounts/codex')
})
afterEach(() => {
  f.db.close()
  rmSync(root, { recursive: true, force: true })
})
function enqueue(
  index = 0,
  patch: Partial<z.infer<typeof AttemptContinuePayloadSchema>> = {},
  dueAt = until
) {
  const task = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[index]
  if (!task) {
    throw new Error('Missing ready Task')
  }
  const { taskId } = task
  f.store.insertAttemptBinding({
    missionId: f.missionId,
    taskId,
    seq: 1,
    branch: `${taskId}/1`,
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  const effect = f.store.transaction('test_cooldown', () =>
    f.store.enqueueEffect({
      kind: 'attempt.continue',
      missionId: f.missionId,
      key: `${taskId}/1`,
      dueAt,
      payload: {
        taskId,
        seq: 1,
        chain: 1,
        failureClass: 'usage_limit',
        account: { provider: 'codex', key: accountKey('codex', '/accounts/codex') },
        ...patch
      }
    })
  )
  if (effect.kind !== 'attempt.continue') {
    throw new Error('Wrong effect kind')
  }
  return effect
}
it('reads the latest wait across Missions and resolves each candidate provider once', async () => {
  enqueue()
  enqueue(1, {}, '2026-11-10T12:02:00.000Z')
  const other = planned({ ...f, controller: new MissionController(f.db, f.store) })
  other.controller.startExecution(other.missionId)
  const original = f
  f = other
  enqueue(0, {}, '2026-11-10T12:03:00.000Z')
  f = original
  expect(await view()).toEqual(new Map([['codex', '2026-11-10T12:03:00.000Z']]))
  expect(homes.codex).toHaveBeenCalledOnce()
  expect(homes.claude).not.toHaveBeenCalled()
})
it('ignores a cooldown recorded for a different account', async () => {
  enqueue()
  homes.codex.mockReturnValue('/accounts/different')
  expect(await view()).toEqual(new Map())
})
it('keeps the cooldown across a restart', async () => {
  enqueue()
  f.db.close()
  f = { ...fixture(path.join(root, 'orchestration.db')), missionId: f.missionId, planId: f.planId }
  expect(await view()).toEqual(new Map([['codex', until]]))
})
it.each([
  'due',
  'running',
  'done',
  'failed',
  'retired',
  'other_class',
  'no_account',
  'canceled',
  'newer'
])('does not cool from %s evidence', async (state) => {
  const effect = enqueue(
    0,
    {
      ...(state === 'other_class' ? { failureClass: 'provider_error' } : {}),
      ...(state === 'no_account' ? { account: undefined } : {})
    },
    state === 'due' ? new Date(now).toISOString() : until
  )
  const fence = {
    id: effect.id,
    expectedStatus: effect.status,
    expectedLeaseEpoch: effect.leaseEpoch
  }
  if (state === 'running') {
    f.store.leaseDueEffect({ kind: effect.kind, missionId: f.missionId, epoch: 'test', now: until })
  }
  if (state === 'done') {
    f.store.completeEffect(fence)
  }
  if (state === 'failed') {
    f.store.failEffectAttempt({ ...fence, lastError: 'round failed', nextDueAt: null })
  }
  if (state === 'retired') {
    f.store.retireEffect({ ...fence, reason: 'adjusted' })
  }
  if (state === 'canceled') {
    f.controller.cancelTask({ taskId: effect.payload.taskId, actor: 'user', rationale: 'cancel' })
  }
  if (state === 'newer') {
    f.store.insertAttemptBinding({
      missionId: f.missionId,
      taskId: effect.payload.taskId,
      seq: 2,
      branch: 'attempt/2',
      dispatchId: null,
      agentSpecId: 'spec',
      contextPackageId: 'context'
    })
  }
  expect(await view()).toEqual(new Map())
  expect(homes.codex).not.toHaveBeenCalled()
})
it.each(['null', 'throws'])('does not cool when the current resolver %s', async (state) => {
  enqueue()
  homes.codex.mockImplementation(() => {
    if (state === 'throws') {
      throw new Error('unavailable')
    }
    return null
  })
  expect(await view()).toEqual(new Map())
})
it('awaits the Claude launch resolver only when Claude has a candidate effect', async () => {
  enqueue(0, { account: { provider: 'claude', key: accountKey('claude', '/accounts/claude') } })
  expect(await view()).toEqual(new Map([['claude', until]]))
  expect(homes.claude).toHaveBeenCalledOnce()
  expect(homes.codex).not.toHaveBeenCalled()
})
it('separates provider and exact home in the one-way digest', () => {
  expect(accountKey('codex', '/accounts/codex')).toMatch(/^[a-f0-9]{64}$/)
  expect(accountKey('claude', '/accounts/codex')).not.toBe(accountKey('codex', '/accounts/codex'))
  expect(accountKey('ab', 'c')).not.toBe(accountKey('a', 'bc'))
})
