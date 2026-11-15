import { axiomClient } from '@/lib/axiom-client'

export async function readMissionPolicy(missionId: string) {
  try {
    return (await axiomClient.showPolicy({ missionId })).policy
  } catch {
    // An optional read failure, including a synchronous throw, stays on the plan card.
    return null
  }
}
