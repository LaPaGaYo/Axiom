import { translate } from '@/i18n/i18n'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import { readVerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
import { VerificationStatus, verificationDuration } from './VerificationStatus'

export function VerificationRuns({
  runs,
  selectedId,
  onSelect
}: {
  runs: readonly VerificationRunView[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto scrollbar-sleek">
      <table
        className="w-full text-left text-xs"
        aria-label={translate('missions.verificationRuns', 'Verification runs')}
      >
        <thead>
          <tr className="border-b border-border">
            {[
              translate('missions.verificationRun', 'Run'),
              translate('missions.verificationStatus', 'Status'),
              translate('missions.verificationReason', 'Reason'),
              translate('missions.candidate', 'Candidate'),
              translate('missions.verifier', 'Verifier'),
              translate('missions.started', 'Started'),
              translate('missions.duration', 'Duration')
            ].map((label) => (
              <th key={label} className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const record = readVerdictRecord(run.verdictDetail)
            return (
              <tr
                key={run.id}
                tabIndex={0}
                aria-selected={run.id === selectedId}
                className="cursor-pointer border-b border-border align-top hover:bg-accent aria-selected:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => onSelect(run.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(run.id)
                  }
                }}
              >
                <td className="break-all px-3 py-3 font-mono">{run.id}</td>
                <td className="px-3 py-3">
                  <VerificationStatus value={run.status} />
                  {record.resolution && (
                    <p className="text-muted-foreground">
                      {translate('missions.resolvedByPerson', 'Resolved by a person')}
                    </p>
                  )}
                </td>
                <td className="break-all px-3 py-3 font-mono">{record.reason ?? '—'}</td>
                <td className="px-3 py-3 font-mono" title={run.candidateCommitSha}>
                  {run.candidateCommitSha.slice(0, 7)}
                </td>
                <td className="px-3 py-3">{run.verifier}</td>
                <td className="px-3 py-3 tabular-nums">
                  {run.startedAt ? <time dateTime={run.startedAt}>{run.startedAt}</time> : '—'}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {verificationDuration(
                    run.startedAt && run.finishedAt
                      ? Date.parse(run.finishedAt) - Date.parse(run.startedAt)
                      : undefined
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
