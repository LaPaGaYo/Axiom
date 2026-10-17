import { DEFAULT_ROUTING_POLICY } from './mission-objects'

// Hand-written shape of LaPaGaYo/flowtask-fixture, fixture-v1,
// scenarios/goal/decomposition.json. IDs and dependsOn edges match the frozen file.
export const decomposition = [
  { id: 'T01', title: 'Sprint validation', dependsOn: [], files: ['src/domain/sprint.ts'] },
  { id: 'T02', title: 'CSV interchange', dependsOn: [], files: ['src/services/csv.ts'] },
  { id: 'T03', title: 'Planning report', dependsOn: [], files: ['src/services/reports/plan.ts'] },
  { id: 'T04', title: 'Storage migration', dependsOn: ['T01', 'T02'], files: ['src/storage/'] },
  {
    id: 'T05',
    title: 'Sprint lifecycle',
    dependsOn: ['T04'],
    files: ['src/services/create-sprint.ts']
  },
  {
    id: 'T06',
    title: 'Sprint membership',
    dependsOn: ['T05'],
    files: ['src/services/assign-sprint.ts']
  },
  { id: 'T07', title: 'Saved views', dependsOn: ['T04'], files: ['src/services/run-view.ts'] },
  {
    id: 'T08',
    title: 'Burndown report',
    dependsOn: ['T06'],
    files: ['src/services/reports/sprint-burndown.ts']
  },
  {
    id: 'T09',
    title: 'CLI commands',
    dependsOn: ['T02', 'T03', 'T06', 'T07', 'T08'],
    files: ['src/cli/']
  },
  {
    id: 'T10',
    title: 'HTTP API',
    dependsOn: ['T02', 'T03', 'T06', 'T07', 'T08'],
    files: ['src/api/']
  },
  { id: 'T11', title: 'Documentation', dependsOn: ['T09', 'T10'], files: ['docs/'] },
  {
    id: 'T12',
    title: 'Acceptance coverage',
    dependsOn: ['T09', 'T10'],
    files: ['tests/integration/']
  }
]

export const provenance = { kind: 'user' as const, actor: 'henry', at: '2026-10-17T12:00:00Z' }
export const goal = {
  objective: 'Deliver sprints',
  constraints: ['Offline'],
  acceptanceCriteria: ['Checks pass'],
  provenance
}
export const policy = {
  routing: DEFAULT_ROUTING_POLICY,
  concurrencyLimit: 3,
  budget: { maxRuntimeMinutes: 120 },
  readinessThreshold: 'INTEGRATED' as const,
  approvalRules: {},
  verificationRules: {},
  nestedWorkerMaxDepth: 1 as const
}
export const mission = {
  id: 'mission-1',
  runId: 'run-1',
  repoId: 'repo-1',
  repoPath: '/repo',
  targetBranch: 'main',
  status: 'DRAFT' as const,
  activeGoalRevisionId: null,
  activePlanRevisionId: null,
  coordinatorOrcaSessionId: 'axiom-mission-session'
}

export function makeProposal() {
  return {
    goalRevisionId: 'goal-1',
    milestones: [{ id: 'M1', title: 'Sprints', exitCriteria: ['Checks pass'] }],
    tasks: decomposition.map((task) => ({
      id: task.id,
      title: task.title,
      objective: task.title,
      scope: { allowedPaths: [...task.files] },
      acceptanceCriteria: ['Checks pass'],
      requiredEvidence: ['Test report'],
      risk: 'low' as const,
      retryPolicy: { maxAttempts: 2 },
      milestoneId: 'M1',
      kind: 'task' as const
    })),
    edges: decomposition.flatMap((task) =>
      task.dependsOn.map((fromTaskId) => ({
        fromTaskId,
        toTaskId: task.id,
        readinessThreshold: 'INTEGRATED' as const
      }))
    ),
    risks: [{ id: 'risk-1', description: 'Migration regression', mitigation: 'Regression checks' }],
    provenance: { ...provenance }
  }
}
