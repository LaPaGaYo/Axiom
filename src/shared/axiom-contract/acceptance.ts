import type { AcceptanceCriterion, TaskSpec } from './mission-objects'

/** Compatible reads only: persisted Tasks retain their original representation. */
export function resolveAcceptance(
  spec: Pick<TaskSpec, 'acceptanceCriteria' | 'requiredEvidence'>
): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = spec.acceptanceCriteria.map((criterion) =>
    typeof criterion === 'string' ? { text: criterion, check: { kind: 'human' } } : criterion
  )
  const commands = new Set(acceptanceCommands(criteria))
  for (const entry of spec.requiredEvidence ?? []) {
    const command = entry.trim()
    if (command && !commands.has(command)) {
      criteria.push({ text: `Command passes: ${command}`, check: { kind: 'command', command } })
      commands.add(command)
    }
  }
  return criteria
}

export function acceptanceCommands(criteria: AcceptanceCriterion[]): string[] {
  return [
    ...new Set(
      criteria.flatMap(({ check }) => (check.kind === 'command' ? [check.command.trim()] : []))
    )
  ]
}
