import { translate } from '@/i18n/i18n'
import type { VerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
import { VerificationStatus } from './VerificationStatus'
import { verificationDispositionGloss } from './verification-disposition-copy'

export function VerificationDisposition({ record }: { record: VerdictRecord }) {
  return (
    <>
      {record.resolution && (
        <section aria-labelledby="verification-resolution-heading" className="space-y-2 text-xs">
          <h4 id="verification-resolution-heading" className="text-sm font-medium">
            {translate('missions.humanResolution', 'Human resolution')}
          </h4>
          <p>
            <VerificationStatus value={record.resolution.verdict} /> · {record.resolution.by} ·{' '}
            <time dateTime={record.resolution.at}>{record.resolution.at}</time>
          </p>
          <p className="whitespace-pre-wrap break-words">{record.resolution.rationale}</p>
          {record.resolution.disposition && (
            <p>
              {translate('missions.disposition', 'Disposition')}:{' '}
              <span className="font-mono">{record.resolution.disposition}</span> ·{' '}
              <span>{verificationDispositionGloss(record.resolution.disposition)}</span>
            </p>
          )}
          {!!record.resolution.criteria.length && (
            <ul
              aria-label={translate(
                'missions.resolvedCriteria',
                'Criteria named in the resolution'
              )}
              className="space-y-1"
            >
              {record.resolution.criteria.map((index) => (
                <li key={index}>
                  #{index} ·{' '}
                  {record.acceptance.find((criterion) => criterion.index === index)?.text ??
                    translate('missions.criterionNotRecorded', 'Criterion text not recorded.')}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {record.rerun && (
        <section aria-labelledby="verification-rerun-heading" className="space-y-2 text-xs">
          <h4 id="verification-rerun-heading" className="text-sm font-medium">
            {translate('missions.verificationRerun', 'Rerun')}
          </h4>
          <p>
            {record.rerun.by} · <time dateTime={record.rerun.at}>{record.rerun.at}</time>
          </p>
          <p className="whitespace-pre-wrap break-words">{record.rerun.rationale}</p>
        </section>
      )}
    </>
  )
}
