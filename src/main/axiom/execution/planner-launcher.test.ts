import { afterEach, beforeEach, expect, it } from 'vitest'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { budgetExhaustion } from '../scheduler/admission-budget'

let f: Awaited<ReturnType<typeof plannerFixture>>
beforeEach(async () => {
  f = await plannerFixture()
})
afterEach(async () => {
  await f.close()
})
const start = () => createPlannerLauncher(f.deps).start(f.mission.id)

it('launches one read-only Planner through the worker start seam, outside the Task DAG', async () => {
  const result = await start()
  const [binding] = f.store.listPlannerBindings(f.mission.id)
  expect(result.attempt).toEqual({
    attemptId: binding.dispatchId,
    seq: 1,
    branch: `axiom/planner/${f.mission.id}/1`,
    worktreeId: 'repo::/fixture/planner',
    provider: 'codex'
  })
  expect(binding.seq).toBe(1)
  expect(f.store.getTaskStage(binding.taskId)).toBeUndefined()
  expect(f.missions.listTasks({ missionId: f.mission.id })).toEqual([])
  expect(JSON.parse(f.db.getTask(binding.taskId)!.spec)).toMatchObject({
    kind: 'planner',
    goalRevisionId: f.goalRevision.id
  })
  expect(f.store.getAgentSpec(binding.agentSpecId)?.spec).toMatchObject({
    role: 'planner',
    permissions: { write: [] }
  })
  expect(binding.contextPackageId).toMatch(/^art_/)
  expect(f.store.getContextPackage(binding.contextPackageId)).toBeUndefined()
  expect(f.createWorktree).toHaveBeenCalledWith(
    expect.objectContaining({
      baseBranch: `axiom/integration/${f.mission.id}`,
      branchNameOverride: binding.branch,
      activate: false
    })
  )
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'planner.started',
      objectId: binding.dispatchId,
      after: expect.objectContaining({ goalRevisionId: f.goalRevision.id })
    })
  )
  await expect(start()).rejects.toMatchObject({
    code: 'invalid_argument',
    message: 'A Planner Attempt is already active for this Mission.'
  })
})

it('falls back to the target branch and permits another run after a failed launch', async () => {
  f.gitRun.mockResolvedValue({ stdout: '', stderr: '' })
  f.gitRun.mockRejectedValueOnce(Object.assign(new Error('missing ref'), { code: 1 }))
  f.startWorker.mockRejectedValueOnce(new Error('launch failure'))
  const first = await start()
  expect(first.attempt.attemptId).toBeNull()
  expect(f.createWorktree).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: 'main' }))
  expect(f.missions.getMission(f.mission.id).status).toBe('ANALYZING')
  const second = await start()
  expect(second.attempt.branch).toBe(`axiom/planner/${f.mission.id}/2`)
  expect(f.store.listPlannerBindings(f.mission.id).map((b) => b.seq)).toEqual([1, 1])
})

it.each([
  ['mission_not_analyzing', 'illegal_transition'],
  ['plan_pending', 'plan_pending'],
  ['no_eligible_provider', 'no_eligible_provider'],
  ['goal_revision_missing', 'invalid_argument']
] as const)('refuses %s before creating a pseudo-task or binding', async (reason, code) => {
  if (reason === 'mission_not_analyzing') {
    f.missions.pauseMission(f.mission.id, 'review')
  }
  if (reason === 'plan_pending') {
    f.missions.proposePlan({
      missionId: f.mission.id,
      planRevision: { ...makeProposal(), goalRevisionId: f.goalRevision.id },
      provenance
    })
  }
  if (reason === 'no_eligible_provider') {
    f.installed.mockResolvedValue([])
  }
  if (reason === 'goal_revision_missing') {
    f.store.setActiveRevisions({ id: f.mission.id, activeGoalRevisionId: null })
  }
  await expect(start()).rejects.toMatchObject({ code })
  expect(f.store.listAttemptBindings({ missionId: f.mission.id })).toEqual([])
  expect(f.startWorker).not.toHaveBeenCalled()
})

it('rejects overlapping requests while building context', async () => {
  const launcher = createPlannerLauncher(f.deps)
  const results = await Promise.allSettled([
    launcher.start(f.mission.id),
    launcher.start(f.mission.id)
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(f.startWorker).toHaveBeenCalledOnce()
})
it('charges the planner against the Mission Attempt budget, including later Worker admission', async () => {
  f.store.upsertPolicy(f.mission.id, {
    ...f.store.getPolicy(f.mission.id)!,
    budget: { maxAttempts: 1 }
  })
  const first = await start()
  f.db.failDispatch(first.attempt.attemptId!, 'exited', {
    workerProcessExited: true,
    terminationReason: 'process_exited'
  })
  await expect(start()).rejects.toMatchObject({ data: { reason: 'budget_exhausted' } })
  expect(
    budgetExhaustion(f.store, f.mission.id, f.store.getPolicy(f.mission.id)!, () =>
      new Date().toISOString()
    )
  ).toMatchObject({ dimension: 'maxAttempts', limit: 1, used: 1 })
})
it('persists ordered reproducible planner sections as two artifacts without a context row', async () => {
  const input = {
    missionId: f.mission.id,
    role: 'planner' as const,
    goalRevisionId: f.goalRevision.id
  }
  const result = await f.contextBuilder.build(input)
  expect(await f.contextBuilder.build(input)).toEqual(result)
  expect(result.manifest.mandatory.map((m) => m.section)).toEqual([
    'Active GoalRevision',
    'Repository rules',
    'PlanProposal contract',
    'Minimal example',
    'Planner proposal recipe'
  ])
  expect(result.renderTemplate).toContain(
    `--mission ${f.mission.id} --attempt {{attemptId}} --dispatch-capability {{dispatchCapability}}`
  )
  expect(result.renderTemplate).toContain('"role"')
  expect(result.renderTemplate).toContain('outside the worktree')
  expect(f.store.listArtifacts({ missionId: f.mission.id })).toHaveLength(2)
  expect(f.store.getContextPackage(result.packageId)).toBeUndefined()
})
