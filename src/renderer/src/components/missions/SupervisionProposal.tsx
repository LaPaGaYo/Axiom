import { useId } from 'react'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { SupervisionProposalSchema } from '../../../../shared/axiom-contract/supervision'
import type { SupervisionActions } from './supervision-actions'
import { stallModeGloss } from './stall-mode-copy'

export function SupervisionProposal({
  proposal,
  canAnswer,
  busy,
  onResolve
}: {
  proposal: z.infer<typeof SupervisionProposalSchema>
  canAnswer: boolean
  busy: boolean
  onResolve: SupervisionActions['resolveSupervision']
}) {
  const id = useId()
  const evidence = proposal.evidence
  const facts = [
    [
      translate('missions.stallKnownOutcomes', 'Stalled Attempts with a known outcome'),
      evidence.known
    ],
    [translate('missions.stallBadOutcomes', 'Ended badly'), evidence.hits],
    [translate('missions.stallPassedOutcomes', 'Passed verification'), evidence.falsePositives],
    [
      translate('missions.stallHitRate', 'Share that ended badly'),
      evidence.hitRate === null
        ? translate('missions.stallNoKnownOutcomes', 'No known outcomes')
        : `${Math.round(evidence.hitRate * 100)}%`
    ],
    [
      translate('missions.stallInconclusiveOutcomes', 'Inconclusive outcomes'),
      evidence.inconclusive
    ],
    [
      translate('missions.stallTimeSaved', 'Time acting at the threshold would have saved'),
      translate('missions.stallMinutesSaved', '{{minutes}} minutes', {
        minutes: Math.round(evidence.savedMs / 60_000)
      })
    ]
  ]
  return (
    <section aria-labelledby={id} className="space-y-3 border-t border-border pt-4 text-sm">
      <h3 id={id} className="font-medium">
        {translate('missions.upgradeProposal', 'Upgrade proposal')}
      </h3>
      <p>
        {translate('missions.stallProposalChange', 'Raises the default for all Missions:')}{' '}
        <span className="font-mono">{proposal.fromMode}</span> →{' '}
        <span className="font-mono">{proposal.toMode}</span>
      </p>
      <dl className="space-y-1 text-xs">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        {translate(
          'missions.stallAcceptConsequence',
          'Accepting sets the default for every Mission without its own setting to'
        )}{' '}
        <span className="font-mono">{proposal.toMode}</span>. {stallModeGloss(proposal.toMode)}
      </p>
      <p className="text-muted-foreground">
        {translate(
          'missions.stallDismissConsequence',
          'Dismissing means the default stays unchanged; outcomes are counted afresh from here, and a new proposal can follow.'
        )}
      </p>
      {canAnswer ? (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void onResolve({ proposalId: proposal.id, resolution: 'accept' }, proposal.toMode)
            }
          >
            {translate('missions.acceptProposal', 'Accept proposal')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void onResolve({ proposalId: proposal.id, resolution: 'dismiss' }, proposal.toMode)
            }
          >
            {translate('missions.dismissProposal', 'Dismiss proposal')}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">
          {translate(
            'missions.stallProposalUnavailable',
            'This proposal cannot be answered from this Mission right now.'
          )}
        </p>
      )}
    </section>
  )
}
