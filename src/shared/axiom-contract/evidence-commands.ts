import type { VerificationRules } from './verification-rules'

export type EvidenceCommandIssue = {
  index: number
  reason: 'multiline' | 'shell_operator' | 'program_not_allowed'
  program?: string
}
// Shape only: quoted operators are rejected too; allowed programs still have full capabilities.
const shellOperator = /[;&|><`]|\$\(/
const basename = (program: string) => program.split('/').at(-1) ?? program
function programOf(command: string): string | undefined {
  const token = command.trim().split(/\s+/)[0]
  return token && !token.includes('=') ? token : undefined
}

export function allowedEvidencePrograms(rules: VerificationRules): string[] {
  return [
    ...new Set([
      ...rules.evidenceCommands.allowedPrograms,
      ...[...rules.setupCommands, ...Object.values(rules.repositoryGates).flat()].flatMap(
        (command) => programOf(command) ?? []
      )
    ])
  ]
}

export function validateEvidenceCommands(
  entries: string[],
  rules: VerificationRules
): EvidenceCommandIssue[] {
  const programs = allowedEvidencePrograms(rules)
  const allowed = new Set(programs.flatMap((program) => [program, basename(program)]))
  return entries.flatMap((entry, index): EvidenceCommandIssue[] => {
    if (/[\r\n\u2028\u2029]/.test(entry)) {
      return [{ index, reason: 'multiline' }]
    }
    if (shellOperator.test(entry)) {
      return [{ index, reason: 'shell_operator' }]
    }
    const program = programOf(entry)
    if (!program || (!allowed.has(program) && !allowed.has(basename(program)))) {
      return [{ index, reason: 'program_not_allowed', ...(program ? { program } : {}) }]
    }
    return []
  })
}

export function evidenceCommandMessage(issue: EvidenceCommandIssue, entry: string): string {
  switch (issue.reason) {
    case 'multiline':
      return 'Each requiredEvidence entry must be a single-line command; newlines are forbidden.'
    case 'shell_operator':
      return `Shell operator ${JSON.stringify(entry.match(shellOperator)?.[0])} is forbidden in requiredEvidence; use one command per entry.`
    case 'program_not_allowed':
      return issue.program
        ? `Program ${JSON.stringify(issue.program)} is not allowed for requiredEvidence commands.`
        : 'Each requiredEvidence command must start with an allowed program; environment assignments are not programs.'
  }
}
