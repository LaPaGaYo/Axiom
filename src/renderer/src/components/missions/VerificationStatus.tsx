import { translate } from '@/i18n/i18n'

export function verificationTone(value: string): string {
  if (value === 'PASS' || value === 'pass') {
    return 'border-status-success-border bg-status-success-background text-status-success'
  }
  if (value === 'FAIL' || value === 'fail') {
    return 'text-destructive'
  }
  if (['HUMAN_REVIEW', 'SPECIALIST_REVIEW', 'human'].includes(value)) {
    return 'border-status-warning-border bg-status-warning-background text-status-warning'
  }
  return 'text-muted-foreground'
}

export function VerificationStatus({ value }: { value: string }) {
  return (
    <span className={verificationTone(value)}>
      {value}
      {(value === 'QUEUED' || value === 'RUNNING') && (
        <> · {translate('missions.verificationInProgress', 'In progress')}</>
      )}
      {(value === 'HUMAN_REVIEW' || value === 'SPECIALIST_REVIEW' || value === 'human') && (
        <> · {translate('missions.needsPerson', 'Needs a person')}</>
      )}
    </span>
  )
}

export function verificationDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return '—'
  }
  return durationMs < 1000
    ? translate('missions.durationMs', '{{value}} ms', { value: durationMs })
    : translate('missions.durationSeconds', '{{value}} s', {
        value: Math.round(durationMs / 10) / 100
      })
}
