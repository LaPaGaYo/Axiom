import { expect, it } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../args'
import { COMMAND_SPECS } from '../specs'
import { AXIOM_ATTEMPT_COMMAND_SPECS } from './axiom-attempt'

it('documents the Attempt-bound report upload', () => {
  expect(
    AXIOM_ATTEMPT_COMMAND_SPECS.find(
      (spec) => spec.path.join(' ') === 'attempt submit'
    )?.notes?.join('\n')
  ).toContain('artifact put --attempt <id> --kind worker_report')
})
it('accepts --attempt on the registered artifact command', () => {
  const parsed = parseArgs(
    [
      'mission',
      'artifact',
      'put',
      '--attempt',
      'attempt-1',
      '--mission',
      'mission-1',
      '--kind',
      'worker_report',
      '--file',
      'REPORT.md'
    ],
    COMMAND_SPECS.map((spec) => spec.path),
    COMMAND_SPECS
  )
  expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
})
