import { axiomClient } from '@/lib/axiom-client'

async function readPolicy(missionId: string, providers?: true) {
  try {
    return await axiomClient.showPolicy({ missionId, ...(providers ? { providers } : {}) })
  } catch {
    // An optional read failure, including a synchronous throw, stays on the plan card.
    return null
  }
}

export async function readMissionPolicy(missionId: string) {
  return (await readPolicy(missionId))?.policy ?? null
}

export async function readProviderEligibility(missionId: string) {
  return (await readPolicy(missionId, true))?.providers ?? null
}
