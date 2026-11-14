import { useCallback, useEffect, useRef, useState } from 'react'
import { axiomClient } from '@/lib/axiom-client'
import { useAppStore } from '@/store'
import type { MissionSummary } from '../../../../shared/axiom-contract/mission-params'
import { readMission, type MissionDetail } from './mission-read'

export function useMissionsPageRead(
  selectedId: string | null,
  selectedTaskId: string | null,
  reportError: (failure: unknown, quiet: boolean) => void
) {
  const [missions, setMissions] = useState<MissionSummary[]>([])
  const [detail, setDetail] = useState<MissionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const reads = useRef({ pending: 0, failed: false })
  const canRead = useCallback(() => reads.current.pending === 0 && !reads.current.failed, [])
  const refresh = useCallback(
    async (quiet = false) => {
      const current = ++generation.current
      const { selectedMissionId: id, selectedTaskId: taskId } = useAppStore.getState()
      // Count superseded reads too: changing selection does not answer the older read.
      reads.current.pending += 1
      if (!quiet) {
        setLoading(true)
      }
      try {
        const [list, next] = await Promise.all([
          axiomClient.listMissions(),
          id ? readMission(id, taskId) : null
        ])
        if (current !== generation.current) {
          return
        }
        setMissions(list.missions)
        setDetail(next)
        if (!quiet) {
          reads.current.failed = false
          useAppStore.getState().setMissionError(null)
        }
      } catch (failure) {
        if (current === generation.current) {
          reads.current.failed = true
          reportError(failure, quiet)
        }
      } finally {
        reads.current.pending -= 1
        if (current === generation.current && !quiet) {
          setLoading(false)
        }
      }
    },
    [reportError]
  )
  // This effect precedes timer installation, so its synchronous first tick sees the mount read.
  useEffect(() => {
    void refresh()
    return () => {
      generation.current += 1
    }
  }, [selectedId, selectedTaskId, refresh])
  return { missions, detail, loading, refresh, canRead }
}
