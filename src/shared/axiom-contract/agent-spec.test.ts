import { describe, expect, it } from 'vitest'
import { AgentSpecSchema, canonicalAgentSpec } from './agent-spec'

const common = {
  version: 1,
  missionId: 'mission-1',
  provider: 'claude',
  model: 'policy-default',
  reasoning: { effort: 'medium' },
  permissions: { write: ['src/storage/'], network: 'restricted', tools: ['shell', 'git-readonly'] },
  budget: { maxRuntimeMinutes: 45 },
  workspace: { strategy: 'attempt-worktree' },
  submissionContract: 'axiom-submission-v1',
  selection: {
    installed: ['claude', 'codex'],
    filtered: [],
    ranked: ['claude', 'codex'],
    chosen: 'claude',
    rationale: 'default'
  }
}
const worker = {
  ...common,
  role: 'worker',
  taskId: 'T04',
  contextPackageId: 'ctx-1',
  acceptanceCriteria: ['Checks pass'],
  capabilities: ['src']
}

describe('AgentSpec execution contract', () => {
  it('canonicalizes schema key order and preserves selection identity', () => {
    const canonical = canonicalAgentSpec(worker)
    expect(canonical).toBe(JSON.stringify(AgentSpecSchema.parse(worker)))
    expect(canonicalAgentSpec(Object.fromEntries(Object.entries(worker).toReversed()))).toBe(
      canonical
    )
    expect(
      canonicalAgentSpec({ ...worker, selection: { ...common.selection, rationale: 'changed' } })
    ).not.toBe(canonical)
    expect(canonical).not.toContain('maxAttempts')
  })
  it('validates worker and read-only planner role variants', () => {
    expect(AgentSpecSchema.parse(worker).role).toBe('worker')
    const planner = {
      ...common,
      role: 'planner',
      goalRevisionId: 'goal-1',
      capabilities: ['planning'],
      permissions: { ...common.permissions, write: [] },
      workspace: { strategy: 'planner-worktree' }
    }
    expect(AgentSpecSchema.parse(planner).role).toBe('planner')
    expect(AgentSpecSchema.safeParse({ ...planner, permissions: common.permissions }).success).toBe(
      false
    )
    expect(AgentSpecSchema.safeParse({ ...worker, contextPackageId: undefined }).success).toBe(
      false
    )
    expect(
      AgentSpecSchema.safeParse({ ...worker, budget: { maxRuntimeMinutes: 45, maxAttempts: 2 } })
        .success
    ).toBe(false)
    expect(AgentSpecSchema.safeParse({ ...worker, provider: 'unknown' }).success).toBe(false)
  })
})
