import { z } from 'zod'
import { PlanProposalSchema } from '../../../shared/axiom-contract/plan-proposal'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import { sha256 } from '../artifacts/artifact-store'
import { markdownSection } from './render'
import { readRepositoryRules } from './repository-rules'
import { redactContext } from './redaction'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { allowedEvidencePrograms } from '../../../shared/axiom-contract/evidence-commands'

/** The Codex terminal-channel proposal recipe. */
export function plannerProposalCommandPrefix(missionId: string, attemptId: string): string {
  return `axiom plan propose --mission ${missionId} --attempt ${attemptId} --file`
}

export async function buildPlannerContext(
  store: AxiomStore,
  artifacts: ArtifactStore,
  p: {
    missionId: string
    goalRevisionId: string
    repositoryRef?: string
    tokenBudget?: number
    provider?: string
  }
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
  const parsedRules = VerificationRulesSchema.safeParse(
    store.getPolicy(mission.id)?.verificationRules
  )
  const rules = parsedRules.success ? parsedRules.data : VerificationRulesSchema.parse({})
  const example = PlanProposalSchema.omit({ provenance: true }).parse({
    goalRevisionId: goal.id,
    milestones: [{ id: 'M1', title: 'Deliver the goal', exitCriteria: ['Acceptance checks pass'] }],
    tasks: ['T1', 'T2'].map((id, i) => ({
      id,
      title: i ? 'Verify the change' : 'Implement the change',
      objective: i ? 'Add regression coverage' : 'Implement the requested behavior',
      scope: { allowedPaths: [i ? 'tests/' : 'src/'] },
      ...(goal.acceptanceCriteria.length ? { coversGoalCriteria: [0] } : {}),
      acceptanceCriteria: i
        ? [
            {
              text: 'A coverage report is attached',
              check: { kind: 'artifact', artifactKind: 'evidence' }
            },
            { text: 'The workflow meets the user intent', check: { kind: 'human' } }
          ]
        : [
            {
              text: 'Relevant tests pass',
              check: { kind: 'command', command: 'pnpm exec vitest run tests/example.test.ts' }
            }
          ],
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
        'Task ids must be unique; every edge endpoint must exist. Use readinessThreshold INTEGRATED only; V1 rejects VERIFIED edges (threshold_not_supported).',
        'The graph must be acyclic with at least one root; milestoneId must reference an existing milestone.',
        'kind: task | fix; risk: low | medium | high; retryPolicy.maxAttempts >= 1.',
        'scope.allowedPaths entries are repository-relative: an entry covers that path and everything below it; * and ? match within one path segment, ** matches any number of segments, and . is the whole repository. Verification fails any change outside allowedPaths.',
        'Name dependency manifests, lockfiles, CI workflows, hooks, test or lint configuration and agent instruction files (AGENTS.md, CLAUDE.md, .claude/, .codex/, .agents/, .mcp.json) in allowedPaths when a Task must change them; otherwise such a change goes to human review.',
        'Name a test file in allowedPaths when a Task must delete it.',
        'Every acceptanceCriteria entry is { text, check }.',
        'Declare coversGoalCriteria on every Task when the Goal lists acceptance criteria; the Control Plane warns on uncovered criteria.',
        'Every Task needs at least one command or artifact criterion; a Task with only human criteria is rejected (acceptance_uncheckable).',
        'Two Tasks with no dependency between them must not list overlapping allowedPaths; put shared files in one Task or add the dependency (dependency manifests and lockfiles especially — DEF-21 ⑦); the Control Plane records scope_overlap warnings for the human.',
        `check.kind = "command" carries one exact shell command; the independent verification runs it verbatim from the repository root and requires exit 0; one command per criterion, no shell operators; the program must be one of: ${allowedEvidencePrograms(rules).join(', ')}; put expectations and descriptions in text, never in command (no "output", "with exit code 0" or other prose).`,
        '"artifact" means the submission must reference a readable, non-empty Artifact (of artifactKind when given).',
        '"human" means no command or Artifact can prove it and a person will confirm it — use it sparingly, the plan shows it.',
        'requiredEvidence is retired and rejected.',
        'Optional TaskSpec.role is a free-text label only; it does not select a provider or materialize skills.',
        'Do not supply provenance; the Control Plane stamps it from the authenticated Planner Attempt.'
      ].join('\n')
    ],
    ['Minimal example', JSON.stringify(example, null, 2)],
    [
      'Planner proposal recipe',
      (p.provider === 'claude'
        ? [
            'Deliver by calling the MCP tool plan_propose with { "proposal": <complete PlanProposal> }. This is your only output channel.',
            'The tool returns ok with warnings or validation issues. Fix rejected issues and call again; warnings are a receipt for human review, not a retry request. A PROPOSED revision prevents re-proposal (plan_pending). The Control Plane keeps one PlanRevision per Attempt.',
            'Do not create, edit or commit any file. Do not run commands beyond the read-only git log, git diff and git show commands.',
            'This is a read-only planning Attempt: permissions.write = []. The worktree must stay clean.'
          ]
        : [
            `${plannerProposalCommandPrefix(mission.id, '{{attemptId}}')} <proposal.json> --json`,
            'do not create, edit or commit any file in this worktree except the proposal JSON you pass with --file; the proposal is read from --file and the worktree must stay clean',
            'Write the proposal JSON outside the worktree (for example in a temporary directory) so git status --porcelain is empty.',
            'This is a read-only planning Attempt: permissions.write = []. Your only output channel is axiom plan propose.'
          ]
      ).join('\n')
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
