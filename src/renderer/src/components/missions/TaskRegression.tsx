import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import { readVerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
import { integrationStatusLabel } from './integration-status-copy'
import { VerificationChecks } from './VerificationChecks'
import { VerificationStatus, verificationDuration } from './VerificationStatus'

export function TaskRegression({
  task,
  regressionRuns,
  regressionError
}: {
  task: TaskListItem
  regressionRuns?: readonly VerificationRunView[]
  regressionError?: boolean
}) {
  useTranslation()
  const batch = task.integration
  if (!batch) {
    return null
  }
  const runs = regressionRuns?.filter((run) => run.batchId === batch.batchId).toReversed() ?? []
  const newest = runs[0]
  return (
    <section aria-labelledby="task-regression-heading" className="space-y-3">
      <h4 id="task-regression-heading" className="text-sm font-semibold">
        {translate('missions.regression', 'Merged-tree regression')}
      </h4>
      <div data-integration-status={batch.status} className="space-y-1 text-sm">
        <p>{integrationStatusLabel(batch.status)}</p>
        <p className="font-mono text-xs text-muted-foreground">{batch.status}</p>
      </div>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{translate('missions.integrationBase', 'Base')}</dt>
          <dd className="font-mono" title={batch.baseCommit}>
            {batch.baseCommit.slice(0, 7)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {translate('missions.integrationMergeCommit', 'Merge commit')}
          </dt>
          <dd className="font-mono" title={batch.mergeCommit ?? undefined}>
            {batch.mergeCommit?.slice(0, 7) ?? '—'}
          </dd>
        </div>
      </dl>
      {batch.conflicts.length > 0 && (
        <div className="space-y-2 text-xs">
          <p className="font-medium">
            {translate('missions.integrationConflicts', 'Conflicting files')}
          </p>
          <ul
            aria-label={translate('missions.integrationConflicts', 'Conflicting files')}
            className="space-y-1"
          >
            {batch.conflicts.map((path, index) => (
              <li key={`${index}:${path}`} className="break-all font-mono">
                {path}
              </li>
            ))}
          </ul>
          {batch.conflicts.length === 200 && (
            <p className="text-muted-foreground">
              {translate(
                'missions.integrationConflictsCut',
                'At most {{total}} files are recorded; there may be more.',
                { total: 200 }
              )}
            </p>
          )}
        </div>
      )}
      {regressionError ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'missions.regressionReadFailed',
            'Regression runs could not be read. Refresh to try again.'
          )}
        </p>
      ) : !newest ? (
        <p className="text-sm text-muted-foreground">
          {translate('missions.noRegressionRuns', 'No regression run for this batch yet.')}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto scrollbar-sleek">
            <table
              className="w-full text-left text-xs"
              aria-label={translate('missions.regressionRuns', 'Regression runs')}
            >
              <thead>
                <tr className="border-b border-border">
                  {[
                    translate('missions.verificationRun', 'Run'),
                    translate('missions.verificationStatus', 'Status'),
                    translate('missions.verificationReason', 'Reason'),
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
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-border align-top">
                    <td className="break-all px-3 py-3 font-mono">{run.id}</td>
                    <td className="px-3 py-3">
                      <VerificationStatus value={run.status} />
                    </td>
                    <td className="break-all px-3 py-3 font-mono">
                      {readVerdictRecord(run.verdictDetail).reason ?? '—'}
                    </td>
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
                ))}
              </tbody>
            </table>
          </div>
          <VerificationChecks
            key={`${newest.id}:${newest.updatedAt}`}
            record={readVerdictRecord(newest.verdictDetail)}
            label={translate('missions.regressionChecks', 'Regression checks')}
            headingId="task-regression-checks-heading"
          />
        </>
      )}
    </section>
  )
}
