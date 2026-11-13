import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { recordBudgetEvidence, recordTokenSpend } from '../token-budget.test-support'
import {
  decideInPlaceContinuation,
  type ContinuationReaders
} from '../execution/in-place-continuation'
import { ContextBuilder } from './context-builder'
import * as rules from './repository-rules'
import { continuationPrompt } from './continuation-prompt'

let f: ReturnType<typeof planned>
let root: string
let taskId: string
let attemptId: string
let builder: ContextBuilder
beforeEach(async () => {
  f = planned()
  root = await mkdtemp(path.join(tmpdir(), 'axiom-token-prompt-'))
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  const task = f.store.listTaskStages({ missionId: f.missionId })[0]
  if (!task) {
    throw new Error('Missing Task')
  }
  taskId = task.taskId
  setCaps(5000, 10000)
  attemptId = recordTokenSpend(f, f.missionId, taskId, 1230, false)
  builder = new ContextBuilder(f.store, new ArtifactStore(f.store, root))
})
afterEach(async () => {
  f.db.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
function setCaps(taskCap?: number, missionCap?: number) {
  const task = f.store.getTaskStage(taskId)
  const policy = f.store.getPolicy(f.missionId)
  if (!task || !policy) {
    throw new Error('Missing budget owner')
  }
  f.store.updateTaskSpec({
    taskId,
    expectedStage: task.stage,
    retryPolicy: task.retryPolicy,
    spec: { ...task.spec, budget: taskCap === undefined ? {} : { maxTokens: taskCap } }
  })
  f.store.upsertPolicy(f.missionId, {
    ...policy,
    budget: missionCap === undefined ? {} : { maxTokens: missionCap }
  })
}
const build = (channel: 'headless' | 'tui' = 'headless') =>
  builder.build({ missionId: f.missionId, taskId, channel })
function continuationInput() {
  return {
    missionId: f.missionId,
    taskId,
    branch: `axiom/attempt/${taskId}/2`,
    continuation: {
      strategy: 'resumed_in_place' as const,
      id: 'thread-1',
      fromSeq: 1,
      originSeq: 1,
      worktree: { id: 'repo::/fixture', path: '/fixture' },
      preserved: false,
      targetCommit: 'a'.repeat(40),
      parentCommit: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      ending: { kind: 'interrupted' as const, failureClass: 'usage_limit' as const }
    }
  }
}
const taskLine = 'Task token budget: 5,000 cap; 1,230 used; 3,770 remaining.'
const missionLine = 'Mission token budget: 10,000 cap; 1,230 used; 8,770 remaining.'
it('states the remaining token budget in the launch and continuation prompts', async () => {
  const result = await build()
  const sections = result.manifest.mandatory.map((s) => s.section)
  expect(sections[sections.indexOf('Permissions, budget and submission contract') + 1]).toBe(
    'Token budget'
  )
  const input = {
    ...continuationInput(),
    tokenBudgets: { task: { limit: 5000, used: 1230 }, mission: { limit: 10000, used: 1230 } }
  }
  recordBudgetEvidence('token-budget-prompts', {
    render: result.renderTemplate,
    continuation: continuationPrompt(input),
    mandatory: result.manifest.mandatory
  })
  for (const prompt of [result.renderTemplate, continuationPrompt(input)]) {
    for (const line of [
      taskLine,
      missionLine,
      'input not served from cache, cache writes and output',
      'across all Attempts of this Task',
      'stops the Attempt, preserves its work and blocks the Task until a person raises the budget',
      'At the Mission cap, no new Attempt starts.'
    ]) {
      expect(prompt).toContain(line)
    }
  }
  expect((await build('tui')).manifest.mandatory.some((s) => s.section === 'Token budget')).toBe(
    false
  )
})
it('keeps resuming in place when only the token usage changed', async () => {
  const first = await build()
  const row = f.store.getAttemptTokenUsage(attemptId)
  if (!row) {
    throw new Error('Missing usage')
  }
  f.store.upsertAttemptTokenUsage({ ...row, newTokens: 1500, inputTokens: 1500 })
  const second = await build()
  const identity = {
    provider: 'codex' as const,
    model: 'policy-default',
    reasoning: { effort: 'medium' as const }
  }
  const readers: ContinuationReaders = {
    previous: () => ({
      seq: 1,
      dispatchId: attemptId,
      branch: `axiom/attempt/${taskId}/1`,
      stopped: false,
      submitted: false,
      failure: {
        reason: 'process_exited',
        evidence: 'exit_code',
        exitCode: 75,
        settlement: { kind: 'interrupted' },
        providerSessionId: 'thread-1'
      },
      preservation: { taskId, baselineSha: 'a'.repeat(40), result: { status: 'empty' } }
    }),
    agents: () => ({ current: identity, previous: identity }),
    version: async () => 'codex-cli 0.163.0',
    accounts: () => ({ current: '/account', previous: '/account' }),
    manifests: () => ({ previous: first.manifest, current: second.manifest }),
    thread: async () => 'thread-1',
    originStartedAt: () => 1000,
    recordExists: async () => true,
    worktree: async () => continuationInput().continuation
  }
  const baseline = {
    kind: 'integration' as const,
    reason: 'previous_attempt_not_submitted' as const,
    skippedAttempts: []
  }
  expect(await decideInPlaceContinuation(taskId, baseline, readers)).toMatchObject({
    strategy: 'resumed_in_place',
    id: 'thread-1'
  })
  setCaps(6000, 10000)
  const changed = await build()
  readers.manifests = () => ({ previous: first.manifest, current: changed.manifest })
  expect(await decideInPlaceContinuation(taskId, baseline, readers)).toEqual({
    strategy: 'fresh',
    reason: 'contract_changed'
  })
})
it('omits token lines without caps and clamps the remainder to zero', async () => {
  setCaps()
  const first = await build()
  expect(first.manifest.mandatory.some((s) => s.section === 'Token budget')).toBe(false)
  expect(first.renderTemplate).not.toContain('Task token budget:')
  const input = continuationInput()
  expect(continuationPrompt({ ...input })).not.toContain('token budget:')
  setCaps(1000)
  expect((await build()).renderTemplate).toContain(
    'Task token budget: 1,000 cap; 1,230 used; 0 remaining.'
  )
  setCaps(undefined, 1000)
  const missionOnly = await build()
  expect(missionOnly.renderTemplate).toContain(
    'Mission token budget: 1,000 cap; 1,230 used; 0 remaining.'
  )
  expect(missionOnly.renderTemplate).not.toContain('Task token budget:')
})
