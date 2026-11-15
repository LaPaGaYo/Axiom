import { useId, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import type { TaskCriteriaDraft } from './use-task-criteria-draft'
import { TaskCriterionFields } from './TaskCriterionFields'

export function TaskCriteriaEditor({
  draft,
  item,
  busy
}: {
  draft: TaskCriteriaDraft
  item: MissionPendingItem
  busy: boolean
}) {
  const id = useId()
  const add = useRef<HTMLButtonElement>(null)
  const title = translate('missions.newAcceptanceCriteria', 'New acceptance criteria')
  const listErrors = draft.issues
    .filter(({ path }) => typeof path[0] !== 'number')
    .map(({ message }) => message)
  if (draft.retired) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'missions.criteriaRetiredEvidence',
          'This Task still lists commands in the retired requiredEvidence field, and the Control Plane refuses to replace the criteria of such a Task (required_evidence_retired).'
        )}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-replace`}
          checked={draft.checked}
          disabled={busy}
          onCheckedChange={(value) => draft.toggle(value === true)}
        />
        <Label htmlFor={`${id}-replace`}>
          {translate('missions.replaceAcceptanceCriteria', 'Replace acceptance criteria')}
        </Label>
      </div>
      {draft.checked && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{title}</legend>
          <p className="text-xs text-muted-foreground">
            {translate(
              'missions.criteriaWholeReplacement',
              "This list replaces the Task's acceptance criteria as a whole."
            )}
          </p>
          {item.kind === 'task_blocked' && item.actions.includes('axiom.verification.rerun') && (
            <p className="text-xs text-muted-foreground">
              {translate(
                'missions.criteriaBlockedReplacement',
                'Replacing only the criteria leaves this Task blocked, so that verification can be rerun on the same Candidate against the new criteria. An adjustment that also carries a path or a limit sends the Task back for another Attempt instead, and is refused when its Attempts are used up.'
              )}
            </p>
          )}
          {draft.policyState === 'unavailable' && (
            <p className="text-xs text-muted-foreground">
              {translate(
                'missions.criteriaPolicyReadError',
                "The Mission's policy could not be read, so the commands are not checked here. The Control Plane checks them when the adjustment is applied."
              )}
            </p>
          )}
          {draft.policyState === 'invalid' && (
            <>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'missions.planPolicyInvalid',
                  "The Mission's verification rules are not valid. Verification would end INCONCLUSIVE (policy_invalid) without running a command."
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'missions.criteriaCommandsUnchecked',
                  'The commands are not checked here. The Control Plane checks them against its default rules when the adjustment is applied.'
                )}
              </p>
            </>
          )}
          <ol
            aria-label={title}
            aria-describedby={listErrors.length ? `${id}-errors` : undefined}
            className="space-y-4"
          >
            {draft.rows.map((row, index) => (
              <TaskCriterionFields
                key={row.key}
                row={row}
                number={index + 1}
                busy={busy}
                issues={draft.issues.filter(({ path }) => path[0] === index)}
                onChange={(change) => draft.update(row.key, change)}
                onRemove={() => {
                  draft.remove(row.key)
                  add.current?.focus()
                }}
              />
            ))}
          </ol>
          {listErrors.length > 0 && (
            <p id={`${id}-errors`} className="text-xs text-destructive">
              {listErrors.join(' ')}
            </p>
          )}
          <Button
            ref={add}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={draft.add}
          >
            {translate('missions.addCriterion', 'Add criterion')}
          </Button>
        </fieldset>
      )}
    </div>
  )
}
