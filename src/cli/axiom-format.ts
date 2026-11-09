import type { MissionResponse, MissionListResponse } from '../shared/axiom-contract/mission-params'
import type { GoalResponse } from '../shared/axiom-contract/goal-params'
import type { PlanResponse, PlanListResponse } from '../shared/axiom-contract/plan-params'
import type { TaskResponse, TaskListResponse } from '../shared/axiom-contract/task-params'
import { resolveAcceptance } from '../shared/axiom-contract/acceptance'
import type {
  VerificationResponse,
  VerificationListResponse
} from '../shared/axiom-contract/verification-params'

function table(rows: { id: string; status: string; title: string }[], status = 'STATUS') {
  return [
    `ID\t${status}\tTITLE`,
    ...rows.map((r) => `${r.id}\t${r.status}\t${r.title.replace(/\s+/g, ' ')}`)
  ].join('\n')
}

export function formatMissionList({ missions }: MissionListResponse): string {
  return table(
    missions.map((m) => ({
      id: m.id,
      status: m.status,
      title: `${m.repoPath} → ${m.targetBranch}`
    }))
  )
}
export function formatMission({ mission }: MissionResponse): string {
  return formatMissionList({ missions: [mission] })
}
export function formatGoal({ goalRevision }: GoalResponse): string {
  return table([
    { id: goalRevision.id, status: goalRevision.status, title: goalRevision.objective }
  ])
}
export function formatPlanList({ planRevisions }: PlanListResponse): string {
  return table(
    planRevisions.map((p) => ({ id: p.id, status: p.status, title: `Revision ${p.revision}` }))
  )
}
export function formatPlan({ planRevision, coverage }: PlanResponse): string {
  const warnings = (planRevision.warnings ?? []).map((warning) => {
    if (warning.code === 'incomplete_coverage') {
      return `[${warning.code}] uncovered: ${warning.uncovered.map(({ index, text }) => `#${index} ${JSON.stringify(text)}`).join(', ')}`
    }
    if (warning.code === 'scope_overlap') {
      const paths = [...new Set(warning.paths.map(({ a, b }) => (a === b ? a : `${a} ∩ ${b}`)))]
      return `[${warning.code}] ${warning.taskIds.join(' ∥ ')}: ${paths.join(', ')}`
    }
    return `[${warning.code}] ${warning.taskIds.join(', ')}: expected ${warning.expected}, found ${warning.found}`
  })
  return [
    formatPlanList({ planRevisions: [planRevision] }),
    'WARNINGS',
    ...(warnings.length ? warnings : ['none']),
    ...(coverage
      ? [
          'COVERAGE',
          ...(coverage.criteria.length
            ? coverage.criteria.map(
                ({ index, text, taskIds }) =>
                  `#${index} ${JSON.stringify(text)} ← ${taskIds.join(', ') || '(none)'}`
              )
            : ['none'])
        ]
      : [])
  ].join('\n')
}
export function formatTaskList({ tasks }: TaskListResponse): string {
  return table(
    tasks.map((t) => ({ id: t.id, status: t.stage, title: t.title })),
    'STAGE'
  )
}
export function formatTask({ task }: TaskResponse): string {
  const criteria = task.spec ? resolveAcceptance(task.spec) : []
  return [
    formatTaskList({ tasks: [task] }),
    ...criteria.map(
      ({ text, check }) =>
        `[${check.kind}] ${text} — ${
          check.kind === 'command'
            ? check.command
            : check.kind === 'artifact'
              ? 'Artifact'
              : 'human check'
        }`
    )
  ].join('\n')
}

export function formatVerificationRunList({ runs }: VerificationListResponse): string {
  return [
    'ID\tTASK\tCANDIDATE\tSTATUS\tREASON\tESCALATION\tPHASE\tCLAIM\tSTARTED\tWORKTREE',
    ...runs.map((run) =>
      [
        run.id,
        run.taskId,
        run.candidateCommitSha.slice(0, 8),
        run.status,
        typeof run.verdictDetail.reason === 'string' ? run.verdictDetail.reason : '-',
        run.status === 'HUMAN_REVIEW' && typeof run.verdictDetail.escalation === 'string'
          ? run.verdictDetail.escalation
          : '-',
        run.phase ?? '-',
        run.claimCount,
        run.startedAt ?? '-',
        run.worktreeId ?? '-'
      ].join('\t')
    )
  ].join('\n')
}
export function formatVerificationRun({ run }: VerificationResponse): string {
  return formatVerificationRunList({ runs: [run] })
}
