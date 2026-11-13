import { axiomClient } from '@/lib/axiom-client'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'

export type TaskTokenUsage = Awaited<ReturnType<typeof axiomClient.missionUsage>>['tasks'][number]
export type TaskEvidenceReads = {
  runs?: readonly VerificationRunView[]
  verificationError?: boolean
  usage?: TaskTokenUsage
  usageError?: boolean
  pendingItems?: readonly MissionPendingItem[]
  pendingError?: boolean
}

export async function readTaskEvidence(
  missionId: string,
  taskId: string
): Promise<TaskEvidenceReads> {
  const [verification, usage, pending] = await Promise.allSettled([
    axiomClient.listVerificationRuns({ missionId, taskId }),
    axiomClient.missionUsage({ missionId, taskId }),
    axiomClient.missionPending({ missionId })
  ])
  return {
    pendingItems:
      pending.status === 'fulfilled'
        ? pending.value.items.filter((item) => item.taskId === taskId)
        : [],
    pendingError: pending.status === 'rejected',
    runs: verification.status === 'fulfilled' ? verification.value.runs : [],
    verificationError: verification.status === 'rejected',
    usage:
      usage.status === 'fulfilled'
        ? usage.value.tasks.find((task) => task.taskId === taskId)
        : undefined,
    usageError: usage.status === 'rejected'
  }
}
