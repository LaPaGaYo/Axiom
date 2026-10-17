import type { MissionResponse, MissionListResponse } from '../shared/axiom-contract/mission-params'
import type { GoalResponse } from '../shared/axiom-contract/goal-params'
import type { PlanResponse, PlanListResponse } from '../shared/axiom-contract/plan-params'
import type { TaskResponse, TaskListResponse } from '../shared/axiom-contract/task-params'

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
export function formatPlan({ planRevision }: PlanResponse): string {
  return formatPlanList({ planRevisions: [planRevision] })
}
export function formatTaskList({ tasks }: TaskListResponse): string {
  return table(
    tasks.map((t) => ({ id: t.id, status: t.stage, title: t.title })),
    'STAGE'
  )
}
export function formatTask({ task }: TaskResponse): string {
  return formatTaskList({ tasks: [task] })
}
