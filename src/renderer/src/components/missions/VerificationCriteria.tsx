import { translate } from '@/i18n/i18n'
import type { VerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
import { VerificationStatus } from './VerificationStatus'

export function VerificationCriteria({
  acceptance,
  resolution,
  status
}: Pick<VerdictRecord, 'acceptance' | 'resolution'> & { status?: string }) {
  return (
    <section aria-labelledby="verification-criteria-heading" className="space-y-2">
      <h4 id="verification-criteria-heading" className="text-sm font-medium">
        {translate('missions.acceptanceCriteria', 'Acceptance criteria')}
      </h4>
      {acceptance.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('missions.noRecordedCriteria', 'No criteria recorded.')}
        </p>
      ) : (
        <ol
          aria-label={translate('missions.acceptanceCriteria', 'Acceptance criteria')}
          className="space-y-3 text-xs"
        >
          {acceptance.map((criterion, position) => (
            <li key={`${criterion.index}:${position}`} className="space-y-1">
              <p className="whitespace-pre-wrap">
                #{criterion.index} · {criterion.text} ·{' '}
                <VerificationStatus
                  value={criterion.result}
                  humanWaiting={
                    !resolution && (status === 'HUMAN_REVIEW' || status === 'SPECIALIST_REVIEW')
                  }
                />
                {criterion.result === 'human' && resolution && (
                  <>
                    {' · '}
                    {resolution.verdict}
                    {' · '}
                    {resolution.criteria.includes(criterion.index)
                      ? translate('missions.criterionNamed', 'Named in the resolution')
                      : translate('missions.criterionNotNamed', 'Not named in the resolution')}
                  </>
                )}
              </p>
              <p>
                {translate('missions.criterionProof', 'Proof')}:{' '}
                <span className="font-mono">{criterion.check.kind}</span>
                {criterion.check.kind === 'command' && (
                  <>
                    {' '}
                    ·{' '}
                    <code className="whitespace-pre-wrap break-all font-mono">
                      {criterion.check.command}
                    </code>
                  </>
                )}
                {criterion.check.kind === 'artifact' && criterion.check.artifactKind && (
                  <> · {criterion.check.artifactKind}</>
                )}
              </p>
              {!!criterion.checkIndexes.length && (
                <p>
                  {translate('missions.verificationChecks', 'Checks')}:{' '}
                  {criterion.checkIndexes.map((index) => `#${index}`).join(', ')}
                </p>
              )}
              {!!criterion.artifactIds.length && (
                <p className="break-all font-mono">
                  {translate('missions.evidenceArtifacts', 'Evidence Artifacts')}:{' '}
                  {criterion.artifactIds.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
