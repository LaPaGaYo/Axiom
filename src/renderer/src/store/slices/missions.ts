import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import type { StateCreator } from 'zustand'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'

type MissionRequest = { id: string; pending: boolean }

export type MissionsSlice = {
  selectedMissionId: string | null
  missionCreateOpen: boolean
  missionRequests: Record<string, MissionRequest>
  missionError: string | null
  openMissionsPage: () => void
  selectMission: (id: string | null) => void
  setMissionCreateOpen: (open: boolean) => void
  setMissionError: (error: string | null) => void
  beginMissionRequest: (key: string) => string | null
  finishMissionRequest: (key: string, retain: boolean) => void
}

export const createMissionsSlice: StateCreator<
  MissionsSlice & { activeView: TopLevelView },
  [],
  [],
  MissionsSlice
> = (set, get) => ({
  selectedMissionId: null,
  missionCreateOpen: false,
  missionRequests: {},
  missionError: null,
  openMissionsPage: () => set({ activeView: 'missions' }),
  selectMission: (id) => set({ selectedMissionId: id, missionError: null }),
  setMissionCreateOpen: (open) => set({ missionCreateOpen: open }),
  setMissionError: (error) => set({ missionError: error }),
  beginMissionRequest: (key) => {
    const requests = get().missionRequests
    if (Object.values(requests).some((request) => request.pending)) {
      return null
    }
    const id = requests[key]?.id ?? createNonSecureContextUuid()
    set({ missionRequests: { ...requests, [key]: { id, pending: true } } })
    return id
  },
  finishMissionRequest: (key, retain) =>
    set((state) => {
      const requests = { ...state.missionRequests }
      const request = requests[key]
      if (retain && request) {
        requests[key] = { ...request, pending: false }
      } else {
        delete requests[key]
      }
      return { missionRequests: requests }
    })
})
