import { translate } from '@/i18n/i18n'
import type { TaskTokenUsage } from './task-evidence-read'

export function AttemptTokens({
  attemptId,
  usage,
  failed
}: {
  attemptId: string | null
  usage?: TaskTokenUsage
  failed?: boolean
}) {
  const reading = usage?.attempts.find((entry) => entry.attemptId === attemptId)
  if (failed) {
    return <span>—</span>
  }
  if (!reading) {
    return <span>{translate('missions.tokensNotMeasured', 'Not measured')}</span>
  }
  return (
    <span className="tabular-nums">
      {reading.newTokens}
      {reading.status !== 'complete' && (
        <>
          {' · '}
          {reading.status === 'partial'
            ? translate('missions.tokensPartial', 'partial')
            : translate('missions.tokensUnavailable', 'unavailable')}
        </>
      )}
    </span>
  )
}

export function TaskTokenTotal({ usage, failed }: { usage?: TaskTokenUsage; failed?: boolean }) {
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {failed
        ? translate('missions.usageReadFailed', 'Usage could not be read. Refresh to try again.')
        : usage
          ? usage.limit === null
            ? translate('missions.taskTokensTotal', 'Task tokens: {{used}}', { used: usage.used })
            : translate('missions.taskTokensCap', 'Task tokens: {{used}} of {{limit}}', {
                used: usage.used,
                limit: usage.limit
              })
          : translate('missions.taskTokensNotMeasured', 'Task tokens: not measured')}
    </p>
  )
}
