import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { SupervisionResolveParams } from '../../../shared/axiom-contract/supervision'
import type { AxiomStore } from '../db/axiom-store'
import {
  STALL_PROPOSAL_MIN_KNOWN,
  STALL_PROPOSAL_MIN_HIT_RATE
} from '../recovery/stall-proposal-policy'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'

export function stallEvidence(store: AxiomStore) {
  const since = Math.max(
    store.getSupervisionSetting({ rule: 'stalled' })?.auditSequence ?? 0,
    store.latestResolvedSupervisionSequence()
  )
  return {
    rule: 'stalled' as const,
    window: store.readSupervisionEvidence(since),
    total: store.readSupervisionEvidence(0)
  }
}

export function proposeStallUpgrade(store: AxiomStore): void {
  store.transaction('stall_proposal', () => {
    const fromMode = store.getSupervisionSetting({ rule: 'stalled' })?.mode ?? 'observe'
    if (fromMode === 'stop' || store.getOpenSupervisionProposal()) {
      return
    }
    const evidence = stallEvidence(store).window
    if (
      evidence.known < STALL_PROPOSAL_MIN_KNOWN ||
      (evidence.hitRate ?? 0) < STALL_PROPOSAL_MIN_HIT_RATE
    ) {
      return
    }
    store.insertSupervisionProposal({
      id: `supervision_${randomUUID()}`,
      rule: 'stalled',
      fromMode,
      toMode: fromMode === 'observe' ? 'notify' : 'stop',
      evidence,
      sinceSequence: evidence.sinceSequence,
      throughSequence: evidence.throughSequence
    })
  })
}

export function resolveStallProposal(
  store: AxiomStore,
  input: z.input<typeof SupervisionResolveParams>
): void {
  const p = SupervisionResolveParams.parse(input)
  store.transaction('supervision_resolve', () => {
    const proposal = store.getSupervisionProposal(p.proposalId)
    if (!proposal) {
      throw new OrchestrationError('invalid_argument', 'Unknown supervision proposal')
    }
    if (proposal.status !== 'OPEN') {
      throw new OrchestrationError('illegal_transition', 'Supervision proposal is already resolved')
    }
    if (p.resolution === 'accept') {
      const mode = store.getSupervisionSetting({ rule: 'stalled' })?.mode ?? 'observe'
      if (mode !== proposal.fromMode) {
        throw new OrchestrationError('stale_state', 'Supervision proposal starting mode changed')
      }
      store.appendSupervisionSetting({
        rule: 'stalled',
        mode: proposal.toMode,
        actor: 'user',
        provenance: { kind: 'proposal', proposalId: proposal.id }
      })
    }
    store.resolveSupervisionProposal({
      id: proposal.id,
      status: p.resolution === 'accept' ? 'ACCEPTED' : 'DISMISSED',
      resolver: 'user'
    })
  })
}
