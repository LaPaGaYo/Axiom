import type { AcceptanceCriterion } from '../../../shared/axiom-contract/mission-objects'

export function acceptanceFromFlags(
  texts: string[],
  commands: string[],
  artifacts: string[]
): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = texts.map((text, index) => ({
    text,
    check:
      index < commands.length ? { kind: 'command', command: commands[index] } : { kind: 'human' }
  }))
  for (const command of commands.slice(texts.length)) {
    criteria.push({ text: `Command passes: ${command}`, check: { kind: 'command', command } })
  }
  criteria.push(...artifacts.map((text) => ({ text, check: { kind: 'artifact' as const } })))
  return criteria
}
