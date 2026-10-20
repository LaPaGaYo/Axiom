import { describe, expect, it } from 'vitest'
import { decomposition } from '../../../src/shared/axiom-contract/contract-fixtures.test-support'
import {
  PlanProposalSchema,
  validatePlanProposal
} from '../../../src/shared/axiom-contract/plan-proposal'
import { fixturePlanProposal } from './fixture-plan-proposal'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'

const at = '2026-10-17T12:00:00Z'
function fixtureInput() {
  return {
    goalId: 'goal-sprints-v1',
    referenceOnly: true,
    tasks: decomposition.map(({ files, ...task }) => ({
      ...task,
      scope: files,
      acceptance: [{ command: 'pnpm run verify:full', must: `${task.id} acceptance passes` }],
      parallelReady: task.dependsOn.length === 0,
      estimatedSize: 'small'
    }))
  }
}

describe('fixture-v1 PlanProposal conversion', () => {
  it('keeps the executable D49 planner conversion identical to the fixture mapping', () => {
    const input = fixtureInput()
    const result: unknown = runInNewContext(
      `${AXIOM_TEST_PROVIDER_SOURCE}\nfixtureProposal(input.tasks, 'goal-1')`,
      {
        input,
        require: createRequire(import.meta.url),
        process: {
          argv: [],
          stdout: { write() {} },
          stdin: { setEncoding() {}, on() {}, resume() {} }
        },
        setInterval() {}
      }
    )
    const { provenance: _provenance, ...expected } = fixturePlanProposal(input, 'goal-1', at)
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected)
  })
  it('preserves twelve Tasks, twenty edges and the three expected READY roots', () => {
    const input = fixtureInput()
    const proposal = fixturePlanProposal(input, 'active-goal-1', at)
    expect(PlanProposalSchema.safeParse(proposal).success).toBe(true)
    expect(validatePlanProposal(proposal)).toMatchObject({ ok: true })
    expect(proposal.tasks).toHaveLength(12)
    expect(proposal.edges).toHaveLength(20)
    const incoming = new Set(proposal.edges.map((edge) => edge.toTaskId))
    const readyRoots = proposal.tasks.filter((task) => !incoming.has(task.id))
    expect(readyRoots.map((task) => task.id).sort()).toEqual(['T01', 'T02', 'T03'])
    expect(proposal.goalRevisionId).toBe('active-goal-1')
    expect(proposal.provenance).toEqual({ kind: 'user', actor: 'e2e', at })
    expect(proposal.milestones).toEqual([
      { id: 'm1', title: 'M1 exit', exitCriteria: ['all 12 Tasks integrated'] }
    ])
    expect(proposal.risks).toEqual([])
    expect(proposal.tasks).toEqual(
      input.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        objective: task.title,
        scope: { allowedPaths: task.scope },
        acceptanceCriteria: task.acceptance.map((entry) => entry.must),
        requiredEvidence: ['pnpm run verify:full'],
        risk: 'low',
        retryPolicy: { maxAttempts: 2 },
        kind: 'task',
        milestoneId: 'm1'
      }))
    )
    expect(proposal.edges).toEqual(
      input.tasks.flatMap((task) =>
        task.dependsOn.map((dep) => ({
          fromTaskId: dep,
          toTaskId: task.id,
          readinessThreshold: 'INTEGRATED'
        }))
      )
    )
  })

  it('deduplicates evidence commands while retaining each acceptance criterion', () => {
    const input = fixtureInput()
    input.tasks[0].acceptance.push({ command: 'pnpm run verify:full', must: 'Second criterion' })
    const task = fixturePlanProposal(input, 'goal-1', at).tasks[0]
    expect(task.requiredEvidence).toEqual(['pnpm run verify:full'])
    expect(task.acceptanceCriteria).toEqual(['T01 acceptance passes', 'Second criterion'])
  })

  it('rejects malformed input and a cyclic converted graph before a file can be written', () => {
    expect(() => fixturePlanProposal({ tasks: [] }, 'goal-1', at)).toThrow()
    const input = fixtureInput()
    input.tasks[0].dependsOn.push('T04')
    expect(() => fixturePlanProposal(input, 'goal-1', at)).toThrow(/cycle/)
  })
})
