import { axiomClient } from '@/lib/axiom-client'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'

export type TaskTokenUsage = Awaited<ReturnType<typeof axiomClient.missionUsage>>['tasks'][number]
export type TaskEvidenceReads = {
  runs?: readonly VerificationRunView[]
  verificationError?: boolean
  usage?: TaskTokenUsage
  usageError?: boolean
}

export async function readTaskEvidence(
  missionId: string,
  taskId: string
): Promise<TaskEvidenceReads> {
  const [verification, usage] = await Promise.allSettled([
    axiomClient.listVerificationRuns({ missionId, taskId }),
    axiomClient.missionUsage({ missionId, taskId })
  ])
  return {
    runs: verification.status === 'fulfilled' ? verification.value.runs : [],
    verificationError: verification.status === 'rejected',
    usage:
      usage.status === 'fulfilled'
        ? usage.value.tasks.find((task) => task.taskId === taskId)
        : undefined,
    usageError: usage.status === 'rejected'
  }
}
