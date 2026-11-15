import { axiomClient } from '@/lib/axiom-client'

export async function readSupervision(missionId: string) {
  try {
    return await axiomClient.showSupervision({ missionId })
  } catch {
    // A failed optional read, including a synchronous throw, belongs only to its region.
    return null
  }
}
