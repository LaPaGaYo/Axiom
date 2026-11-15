import { axiomClient } from '@/lib/axiom-client'
import { readTaskEvidence } from './task-evidence-read'
import { readMissionPolicy } from './mission-policy-read'
import { readSupervision } from './supervision-read'

export async function readMission(missionId: string, taskId: string | null) {
  const supervisionRead = readSupervision(missionId)
  const policyRead = readMissionPolicy(missionId)
  const pendingRead = Promise.allSettled([axiomClient.missionPending({ missionId })]).then(
    ([result]) => result
  )
  const [
    { mission },
    { tasks },
    { planRevisions },
    { attempts },
    taskDetail,
    pending,
    supervision,
    policy
  ] = await Promise.all([
    axiomClient.showMission({ missionId }),
    axiomClient.listTasks({ missionId }),
    axiomClient.listPlans({ missionId }),
    axiomClient.listAttempts({ missionId }),
    taskId
      ? Promise.all([
          axiomClient.listAttempts({ missionId, taskId }),
          axiomClient.listMessages({ missionId, taskId }),
          readTaskEvidence(missionId, taskId, pendingRead)
        ]).then(([attempts, messages, evidence]) => ({
          taskId,
          ...attempts,
          ...messages,
          ...evidence
        }))
      : null,
    pendingRead,
    supervisionRead,
    policyRead
  ])
  const goal = mission.activeGoalRevisionId
    ? (await axiomClient.showGoal({ missionId, goalRevisionId: mission.activeGoalRevisionId }))
        .goalRevision
    : null
  return {
    mission,
    tasks,
    plans: planRevisions,
    goal,
    attempts,
    pendingItems: pending.status === 'fulfilled' ? pending.value.items : [],
    pendingError: pending.status === 'rejected',
    supervision,
    policy,
    taskDetail
  }
}

export type MissionDetail = Awaited<ReturnType<typeof readMission>>
