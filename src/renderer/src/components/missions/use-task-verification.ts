import { useRef, useState } from 'react'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'

export function useTaskVerification(runs: readonly VerificationRunView[] = []) {
  const [selectedId, selectRun] = useState<string | null>(null)
  const region = useRef<HTMLElement>(null)
  // The RPC returns creation order, including insertion order for equal timestamps.
  const newestFirst = runs.toReversed()
  const latest = newestFirst[0]
  const selected = newestFirst.find((run) => run.id === selectedId) ?? latest
  const openRun = (id?: string) => {
    selectRun(id ?? latest?.id ?? null)
    region.current?.focus({ preventScroll: true })
    region.current?.scrollIntoView?.({ block: 'nearest' })
  }
  return { newestFirst, latest, selected, selectRun, openRun, region }
}
