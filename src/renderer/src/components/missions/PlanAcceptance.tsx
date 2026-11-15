import { translate } from '@/i18n/i18n'
import { resolveAcceptance } from '../../../../shared/axiom-contract/acceptance'
import type {
  AcceptanceCriterion,
  TaskSpec
} from '../../../../shared/axiom-contract/mission-objects'

export function reviewCriteria(task: TaskSpec) {
  const occurrences = new Map<string, number>()
  return resolveAcceptance(task).map((criterion) => {
    const identity = JSON.stringify(criterion)
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return { criterion, key: `${identity}:${occurrence}` }
  })
}

export function PlanAcceptance({
  criterion,
  explain = false
}: {
  criterion: AcceptanceCriterion
  explain?: boolean
}) {
  const { check } = criterion
  return (
    <>
      <p>{criterion.text}</p>
      <p>
        {translate('missions.planProof', 'Proof')}: <span className="font-mono">{check.kind}</span>
        {check.kind === 'artifact' && check.artifactKind && <> · {check.artifactKind}</>}
      </p>
      {check.kind === 'command' && (
        <code className="block whitespace-pre-wrap break-all font-mono text-xs">
          {check.command}
        </code>
      )}
      {explain &&
        (check.kind === 'command' ? (
          <p className="text-muted-foreground">
            {translate(
              'missions.planCommandProof',
              'Verification runs this command from the repository root on the candidate and requires exit 0.'
            )}
          </p>
        ) : check.kind === 'artifact' ? (
          <>
            <p>{translate('missions.acceptanceArtifact', 'Artifact')}</p>
            <p className="text-muted-foreground">
              {translate(
                'missions.planArtifactProof',
                'The submission must reference a readable, non-empty Artifact of the declared kind, when given.'
              )}
            </p>
          </>
        ) : (
          <>
            <p>{translate('missions.acceptanceHumanCheck', 'Human check')}</p>
            <p className="text-muted-foreground">
              {translate('missions.planHumanProof', 'A person confirms this criterion.')}
            </p>
          </>
        ))}
    </>
  )
}
