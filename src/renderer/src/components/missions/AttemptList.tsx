import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { AttemptSummary } from '../../../../shared/axiom-contract/attempt-params'

export function AttemptList({
  attempts,
  onOpenWorktree
}: {
  attempts: readonly AttemptSummary[]
  onOpenWorktree: (worktreeId: string) => void
}) {
  const states = {
    LAUNCH_PENDING: translate('missions.attemptLaunchPending', 'Launch pending'),
    STARTING: translate('missions.attemptStarting', 'Starting'),
    RUNNING: translate('missions.attemptRunning', 'Running'),
    SUBMITTED: translate('missions.attemptSubmitted', 'Submitted'),
    FAILED: translate('missions.attemptFailed', 'Failed'),
    STOPPED: translate('missions.attemptStopped', 'Stopped'),
    ABANDONED: translate('missions.attemptAbandoned', 'Abandoned'),
    START_UNKNOWN: translate('missions.attemptStartUnknown', 'Start unknown'),
    STOP_UNKNOWN: translate('missions.attemptStopUnknown', 'Stop unknown')
  }
  return (
    <section className="space-y-2" aria-labelledby="task-attempts-heading">
      <h3 id="task-attempts-heading" className="text-sm font-semibold">
        {translate('missions.attempts', 'Attempts')}
      </h3>
      {attempts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('missions.noAttempts', 'No Attempts yet.')}
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-sleek">
          <table
            className="w-full text-left text-xs"
            aria-label={translate('missions.attempts', 'Attempts')}
          >
            <thead>
              <tr className="border-b border-border">
                {[
                  translate('missions.attemptSeq', 'Attempt'),
                  translate('missions.branch', 'Branch'),
                  translate('missions.provider', 'Provider'),
                  translate('missions.attemptState', 'State'),
                  translate('missions.liveness', 'Liveness'),
                  translate('missions.workspace', 'Workspace'),
                  translate('missions.created', 'Created'),
                  translate('missions.updated', 'Updated')
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...attempts]
                .sort((a, b) => a.seq - b.seq)
                .map((attempt) => (
                  <tr key={attempt.seq} className="border-b border-border align-top">
                    <td className="px-3 py-3 tabular-nums">{attempt.seq}</td>
                    <td className="break-all px-3 py-3 font-mono">{attempt.branch}</td>
                    <td className="px-3 py-3">{attempt.provider ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Badge variant="secondary">{states[attempt.state]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      {attempt.liveness ?? '—'}
                      {attempt.liveness !== 'live' && attempt.livenessReason && (
                        <p className="text-muted-foreground">{attempt.livenessReason}</p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {attempt.workspace ?? '—'}
                      {attempt.worktreeId && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto max-w-full whitespace-normal break-all"
                          onClick={() => onOpenWorktree(attempt.worktreeId!)}
                        >
                          {attempt.worktreeId}
                        </Button>
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <time dateTime={attempt.createdAt}>{attempt.createdAt}</time>
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <time dateTime={attempt.updatedAt}>{attempt.updatedAt}</time>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
