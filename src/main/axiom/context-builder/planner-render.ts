import { z } from 'zod'
import { PlanProposalSchema } from '../../../shared/axiom-contract/plan-proposal'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import { sha256 } from '../artifacts/artifact-store'
import { markdownSection } from './render'
import { readRepositoryRules } from './repository-rules'
import { redactContext } from './redaction'

export async function buildPlannerContext(
  store: AxiomStore,
  artifacts: ArtifactStore,
  p: { missionId: string; goalRevisionId: string; repositoryRef?: string; tokenBudget?: number }
) {
  const mission = store.getMission(p.missionId)
  const goal = store.getGoalRevision(p.goalRevisionId)
  if (
    !mission ||
    !goal ||
    goal.missionId !== mission.id ||
    goal.status !== 'ACTIVE' ||
    mission.activeGoalRevisionId !== goal.id
  ) {
    throw new Error('planner_goal_mismatch')
  }
  const example = PlanProposalSchema.omit({ provenance: true }).parse({
    goalRevisionId: goal.id,
    milestones: [{ id: 'M1', title: 'Deliver the goal', exitCriteria: ['Acceptance checks pass'] }],
    tasks: ['T1', 'T2'].map((id, i) => ({
      id,
      title: i ? 'Verify the change' : 'Implement the change',
      objective: i ? 'Add regression coverage' : 'Implement the requested behavior',
      scope: { allowedPaths: [i ? 'tests/' : 'src/'] },
      acceptanceCriteria: ['Relevant tests pass'],
      requiredEvidence: ['Test results'],
      risk: 'low',
      retryPolicy: { maxAttempts: 2 },
      milestoneId: 'M1',
      kind: 'task'
    })),
    edges: [{ fromTaskId: 'T1', toTaskId: 'T2' }],
    risks: []
  })
  const sections = [
    [
      'Active GoalRevision',
      JSON.stringify(
        {
          goalRevisionId: goal.id,
          objective: goal.objective,
          constraints: goal.constraints,
          acceptanceCriteria: goal.acceptanceCriteria
        },
        null,
        2
      )
    ],
    [
      'Repository rules',
      await readRepositoryRules(mission.repoPath, p.repositoryRef ?? mission.targetBranch)
    ],
    [
      'PlanProposal contract',
      [
        JSON.stringify(z.toJSONSchema(PlanProposalSchema.omit({ provenance: true })), null, 2),
        'Task ids must be unique; every edge endpoint must exist. readinessThreshold defaults to INTEGRATED.',
        'The graph must be acyclic with at least one root; milestoneId must reference an existing milestone.',
        'kind: task | fix; risk: low | medium | high; retryPolicy.maxAttempts >= 1.',
        'Optional TaskSpec.role is a free-text label only; it does not select a provider or materialize skills.',
        'Do not supply provenance; the Control Plane stamps it from the authenticated Planner Attempt.'
      ].join('\n')
    ],
    ['Minimal example', JSON.stringify(example, null, 2)],
    [
      'Planner proposal recipe',
      [
        `axiom plan propose --mission ${mission.id} --attempt {{attemptId}} --dispatch-capability {{dispatchCapability}} --file <proposal.json> --json`,
        'do not create, edit or commit any file in this worktree except the proposal JSON you pass with --file; the proposal is read from --file and the worktree must stay clean',
        'Write the proposal JSON outside the worktree (for example in a temporary directory) so git status --porcelain is empty.',
        'This is a read-only planning Attempt: permissions.write = []. Your only output channel is axiom plan propose.'
      ].join('\n')
    ]
  ].map(([section, content]) => ({
    section,
    text: markdownSection(section, redactContext(content).content)
  }))
  const renderTemplate = sections.map((s) => s.text).join('\n')
  const tokenBudget = p.tokenBudget ?? store.getContextTokenBudget(mission.id) ?? 24_000
  const mandatory = sections.map(({ section, text }) => ({
    section,
    sha256: sha256(text),
    tokens: Math.ceil(Buffer.byteLength(text) / 4)
  }))
  const manifest = {
    version: 1,
    role: 'planner',
    missionId: mission.id,
    goalRevisionId: goal.id,
    tokenBudget,
    mandatory,
    budgetExceededByMandatory: mandatory.reduce((sum, s) => sum + s.tokens, 0) > tokenBudget
  }
  const common = { missionId: mission.id, related: [goal.id], createdBy: 'ContextBuilder' }
  await artifacts.put({
    ...common,
    kind: 'context_package_manifest',
    mediaType: 'application/json',
    content: Buffer.from(JSON.stringify(manifest))
  })
  const render = await artifacts.put({
    ...common,
    kind: 'context_package_render',
    mediaType: 'text/markdown',
    content: Buffer.from(renderTemplate)
  })
  // A planner predates any PlanRevision; context_packages.plan_revision_id is NOT NULL.
  return { packageId: render.id, manifest, renderTemplate }
}
