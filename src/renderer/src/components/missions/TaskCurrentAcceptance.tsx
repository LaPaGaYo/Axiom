import { useId } from 'react'
import { translate } from '@/i18n/i18n'
import type { TaskSpec } from '../../../../shared/axiom-contract/mission-objects'
import { PlanAcceptance, reviewCriteria } from './PlanAcceptance'

export function TaskCurrentAcceptance({ spec }: { spec?: TaskSpec }) {
  const id = useId()
  const title = translate('missions.currentAcceptanceCriteria', 'Current acceptance criteria')
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-sm font-medium">
        {title}
      </h3>
      {spec ? (
        <ul aria-label={title} className="space-y-3 text-xs">
          {reviewCriteria(spec).map(({ criterion, key }) => (
            <li key={key} className="space-y-1">
              <PlanAcceptance criterion={criterion} explain />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'missions.currentAcceptanceReadError',
            'The acceptance criteria of this Task could not be read. Refresh to try again.'
          )}
        </p>
      )}
    </section>
  )
}
