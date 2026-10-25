import { describe, expect, it } from 'vitest'
import { PlanProposalSchema, validatePlanProposal } from './plan-proposal'
import { decomposition, makeProposal } from './contract-fixtures.test-support'

describe('PlanRevision proposal', () => {
  it('validates the 12-task fixture, three roots and a longest chain of seven tasks', () => {
    const proposal = makeProposal()
    expect(PlanProposalSchema.safeParse(proposal).success).toBe(true)
    expect(
      decomposition.filter((task) => task.dependsOn.length === 0).map((task) => task.id)
    ).toEqual(['T01', 'T02', 'T03'])
    const depths = new Map<string, number>()
    for (const task of decomposition) {
      depths.set(task.id, 1 + Math.max(0, ...task.dependsOn.map((id) => depths.get(id) ?? 0)))
    }
    expect(Math.max(...depths.values())).toBe(7)
    expect(validatePlanProposal(proposal, { requireParallelRoots: 3 })).toEqual({
      ok: true,
      order: decomposition.map((task) => task.id)
    })
  })
  it('sorts ties by id independent of task/edge input order without mutating input', () => {
    const proposal = makeProposal()
    proposal.tasks.reverse()
    proposal.edges.reverse()
    const before = JSON.stringify(proposal)
    const first = validatePlanProposal(proposal)
    expect(first).toEqual({ ok: true, order: decomposition.map((task) => task.id) })
    expect(JSON.stringify(validatePlanProposal(proposal))).toBe(JSON.stringify(first))
    expect(JSON.stringify(proposal)).toBe(before)
  })
  it('uses directed dependencies even when lexically later ids are prerequisites', () => {
    const proposal = makeProposal()
    proposal.tasks = proposal.tasks.slice(0, 3)
    proposal.edges = [{ fromTaskId: 'T03', toTaskId: 'T01', readinessThreshold: 'INTEGRATED' }]
    expect(validatePlanProposal(proposal)).toEqual({ ok: true, order: ['T02', 'T03', 'T01'] })
  })
  it.each([
    ['duplicate_task_id', (p: ReturnType<typeof makeProposal>) => p.tasks.push(p.tasks[0])],
    [
      'unknown_edge_endpoint',
      (p: ReturnType<typeof makeProposal>) =>
        p.edges.push({ fromTaskId: 'missing', toTaskId: 'T01', readinessThreshold: 'INTEGRATED' })
    ],
    [
      'self_edge',
      (p: ReturnType<typeof makeProposal>) =>
        p.edges.push({ fromTaskId: 'T01', toTaskId: 'T01', readinessThreshold: 'INTEGRATED' })
    ],
    ['duplicate_edge', (p: ReturnType<typeof makeProposal>) => p.edges.push(p.edges[0])],
    [
      'unknown_milestone',
      (p: ReturnType<typeof makeProposal>) => {
        p.tasks[0].milestoneId = 'missing'
      }
    ]
  ])('rejects %s with deterministic errors', (code, mutate) => {
    const proposal = makeProposal()
    mutate(proposal)
    const result = validatePlanProposal(proposal)
    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code, severity: 'error' })])
    })
    expect(JSON.stringify(validatePlanProposal(proposal))).toBe(JSON.stringify(result))
  })
  it('reports the three cycle ids without mislabeling descendants', () => {
    const proposal = makeProposal()
    proposal.edges.push({ fromTaskId: 'T06', toTaskId: 'T04', readinessThreshold: 'INTEGRATED' })
    const result = validatePlanProposal(proposal)
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: 'cycle', taskIds: ['T04', 'T05', 'T06'] }]
    })
    expect(JSON.stringify(validatePlanProposal(proposal))).toBe(JSON.stringify(result))
  })
  it('checks both edge endpoints and considers thresholds irrelevant to edge identity', () => {
    const proposal = makeProposal()
    expect(
      validatePlanProposal({ ...proposal, edges: [{ fromTaskId: 'T01', toTaskId: 'missing' }] })
    ).toMatchObject({ ok: false, errors: [{ code: 'unknown_edge_endpoint' }] })
    expect(
      validatePlanProposal({
        ...proposal,
        edges: [...proposal.edges, { ...proposal.edges[0], readinessThreshold: 'VERIFIED' }]
      })
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        {
          code: 'duplicate_edge',
          severity: 'error',
          message: expect.any(String),
          taskIds: expect.any(Array)
        }
      ])
    })
  })
  it('rejects VERIFIED edges in V1 without removing the stored enum', () => {
    const proposal = PlanProposalSchema.parse(makeProposal())
    proposal.edges[0].readinessThreshold = 'VERIFIED'
    expect(PlanProposalSchema.safeParse(proposal).success).toBe(true)
    expect(validatePlanProposal(proposal)).toMatchObject({
      ok: false,
      errors: [
        {
          code: 'threshold_not_supported',
          severity: 'error',
          message: 'V1 supports only INTEGRATED dependencies'
        }
      ]
    })
  })
  it('only emits the parallel-root warning when requested', () => {
    const proposal = makeProposal()
    proposal.edges.push({ fromTaskId: 'T01', toTaskId: 'T02', readinessThreshold: 'INTEGRATED' })
    expect(validatePlanProposal(proposal).ok).toBe(true)
    expect(validatePlanProposal(proposal, { requireParallelRoots: 3 })).toMatchObject({
      ok: false,
      errors: [
        { code: 'insufficient_parallel_roots', severity: 'warning', taskIds: ['T01', 'T03'] }
      ]
    })
  })
  it.each([
    null,
    {},
    { ...makeProposal(), tasks: [{ id: '' }] },
    { ...makeProposal(), provenance: {} }
  ])('reports schema errors without throwing', (proposal) => {
    const result = validatePlanProposal(proposal)
    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: 'invalid_schema' })])
    })
    expect(JSON.stringify(validatePlanProposal(proposal))).toBe(JSON.stringify(result))
  })
})
