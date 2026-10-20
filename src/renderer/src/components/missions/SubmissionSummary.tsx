import { translate } from '@/i18n/i18n'
import type { AttemptSummary } from '../../../../shared/axiom-contract/attempt-params'

export function SubmissionSummary({ submission }: { submission?: AttemptSummary['submission'] }) {
  return (
    <section className="space-y-3" aria-labelledby="task-submission-heading">
      <h3 id="task-submission-heading" className="text-sm font-semibold">
        {translate('missions.submissionSummary', 'Submission summary')}
      </h3>
      {!submission ? (
        <p className="text-sm text-muted-foreground">
          {translate('missions.noSubmission', 'No Submission yet.')}
        </p>
      ) : (
        <>
          <dl
            className="space-y-2 text-sm"
            aria-label={translate('missions.candidate', 'Candidate')}
          >
            <div>
              <dt className="text-muted-foreground">
                {translate('missions.candidateCommit', 'Candidate commit')}
              </dt>
              <dd className="font-mono" title={submission.commitSha}>
                {submission.commitSha.slice(0, 7)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {translate('missions.candidateTree', 'Candidate tree')}
              </dt>
              <dd className="break-all font-mono">{submission.treeSha}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{translate('missions.created', 'Created')}</dt>
              <dd className="tabular-nums">
                <time dateTime={submission.createdAt}>{submission.createdAt}</time>
              </dd>
            </div>
          </dl>
          {[
            {
              label: translate('missions.filesChanged', 'Files changed'),
              items: submission.filesChanged
            },
            {
              label: translate('missions.limitations', 'Limitations'),
              items: submission.limitations
            },
            { label: translate('missions.risks', 'Risks'), items: submission.risks },
            { label: translate('missions.followUps', 'Follow-ups'), items: submission.followUps }
          ].map(({ label, items }) => (
            <div key={label} className="space-y-1">
              <h4 className="text-xs font-medium">{label}</h4>
              {items.length > 0 ? (
                <ul className="list-disc space-y-1 break-words pl-5 text-sm" aria-label={label}>
                  {items.map((item, index) => (
                    <li key={`${index}:${item}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {translate('missions.noneReported', 'None reported.')}
                </p>
              )}
            </div>
          ))}
          <div className="space-y-1">
            <h4 className="text-xs font-medium">{translate('missions.checksRun', 'Checks run')}</h4>
            {submission.checksRun.length > 0 ? (
              <pre
                className="whitespace-pre-wrap break-words text-xs"
                aria-label={translate('missions.checksRun', 'Checks run')}
              >
                {submission.checksRun
                  .map(
                    (check) =>
                      `${check.command} · ${check.result}${check.note ? `\n${check.note}` : ''}`
                  )
                  .join('\n\n')}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                {translate('missions.noneReported', 'None reported.')}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
