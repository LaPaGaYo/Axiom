import { useId, useState } from 'react'
import type { axiomClient } from '@/lib/axiom-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { TaskSpec } from '../../../../shared/axiom-contract/mission-objects'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'

export type AdjustTask = (
  params: Parameters<typeof axiomClient.adjustTask>[0]
) => void | Promise<void>

function adjustmentGuidance(item: MissionPendingItem) {
  if (item.kind === 'human_review') {
    return translate(
      'missions.adjustReviewGuidance',
      'The review stays open after an adjustment. Rerun verification to check the same Candidate against the adjusted Task.'
    )
  }
  switch (item.reason) {
    case 'scope':
      return translate(
        'missions.adjustScopeGuidance',
        'The Worker asked for paths outside the scope of the Task. Add them and the next Attempt can continue.'
      )
    case 'candidate_disputed':
      return translate(
        'missions.adjustCandidateGuidance',
        'The Worker reported that the Candidate is already correct or that the failure cannot be reproduced. A rationale alone reopens the Task for another Attempt.'
      )
    case 'environment':
      return translate(
        'missions.adjustEnvironmentGuidance',
        'The environment interrupted the Attempts of this Task repeatedly. A rationale alone reopens the Task.'
      )
    case 'retry_budget_exhausted':
    case 'task_attempts':
      return translate(
        'missions.adjustAttemptsGuidance',
        'The Attempts of this Task are used up. Raise the Attempt limit above the number used.'
      )
    case 'token_budget_exhausted':
    case 'task_tokens':
      return translate(
        'missions.adjustTokensGuidance',
        'The token limit of this Task is reached. Raise it above the tokens used, and raise the Attempt limit too when the Attempts are used up.'
      )
    default:
      return null
  }
}

function validLimit(value: string) {
  return (
    value === '' ||
    (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0)
  )
}

export function TaskAdjustForm({
  taskId,
  spec,
  item,
  initialPaths,
  busy,
  onSubmit,
  onClose
}: {
  taskId: string
  spec: TaskSpec
  item: MissionPendingItem
  initialPaths: string
  busy: boolean
  onSubmit?: AdjustTask
  onClose: () => void
}) {
  const id = useId()
  const [paths, setPaths] = useState(initialPaths)
  const [attempts, setAttempts] = useState('')
  const [tokens, setTokens] = useState('')
  const [rationale, setRationale] = useState('')
  const ready = !busy && !!rationale.trim() && validLimit(attempts) && validLimit(tokens)
  const budget = item.waitingOn?.budget
  const guidance = adjustmentGuidance(item)
  return (
    <form
      aria-label={translate('missions.adjustTask', 'Adjust Task')}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) {
          void onSubmit?.({
            taskId,
            rationale: rationale.trim(),
            addAllowedPaths: [
              ...new Set(
                paths
                  .split('\n')
                  .map((path) => path.trim())
                  .filter(Boolean)
              )
            ],
            ...(attempts === '' ? {} : { maxAttempts: Number(attempts) }),
            ...(tokens === '' ? {} : { maxTokens: Number(tokens) })
          })
        }
      }}
    >
      <dl className="space-y-2 text-sm">
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {translate('missions.allowedPaths', 'Allowed paths')}
          </dt>
          <dd>
            {spec.scope.allowedPaths.length ? (
              <ul className="space-y-1">
                {spec.scope.allowedPaths.map((path) => (
                  <li key={path} className="break-all font-mono text-xs">
                    {path}
                  </li>
                ))}
              </ul>
            ) : (
              translate('missions.noAllowedPaths', 'None')
            )}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {translate('missions.attemptLimit', 'Attempt limit')}
          </dt>
          <dd>{spec.retryPolicy.maxAttempts}</dd>
          {budget?.scope === 'task' && budget.dimension === 'maxAttempts' && (
            <dd className="text-xs text-muted-foreground">
              {translate('missions.taskLimitUsed', '{{used}} used', { used: budget.used })}
            </dd>
          )}
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {translate('missions.tokenLimit', 'Token limit')}
          </dt>
          <dd>{spec.budget?.maxTokens ?? translate('missions.noTokenLimit', 'No limit')}</dd>
          {budget?.scope === 'task' && budget.dimension === 'maxTokens' && (
            <dd className="text-xs text-muted-foreground">
              {translate('missions.taskLimitUsed', '{{used}} used', { used: budget.used })}
            </dd>
          )}
        </div>
      </dl>
      {guidance && <p className="text-xs text-muted-foreground">{guidance}</p>}
      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-paths`}>
            {translate('missions.allowedPathsToAdd', 'Allowed paths to add')}
          </Label>
          <p id={`${id}-paths-hint`} className="text-xs text-muted-foreground">
            {translate('missions.onePathPerLine', 'One path per line.')}
          </p>
        </div>
        <Textarea
          id={`${id}-paths`}
          aria-describedby={`${id}-paths-hint`}
          value={paths}
          disabled={busy}
          onChange={(event) => setPaths(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-attempts`}>
          {translate('missions.newAttemptLimit', 'New Attempt limit')}
        </Label>
        <Input
          id={`${id}-attempts`}
          type="text"
          inputMode="numeric"
          value={attempts}
          disabled={busy}
          aria-invalid={!validLimit(attempts)}
          onChange={(event) => setAttempts(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-tokens`}>
          {translate('missions.newTokenLimit', 'New token limit')}
        </Label>
        <Input
          id={`${id}-tokens`}
          type="text"
          inputMode="numeric"
          value={tokens}
          disabled={busy}
          aria-invalid={!validLimit(tokens)}
          onChange={(event) => setTokens(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-rationale`}>{translate('missions.rationale', 'Rationale')}</Label>
        <Textarea
          id={`${id}-rationale`}
          required
          maxLength={4000}
          value={rationale}
          disabled={busy}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={!ready}>
          {translate('missions.applyAdjustment', 'Apply adjustment')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {translate('missions.close', 'Close')}
        </Button>
      </div>
    </form>
  )
}
