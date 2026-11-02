import { expect, it } from 'vitest'
import { validateEvidenceCommands, allowedEvidencePrograms } from './evidence-commands'
import { VerificationRulesSchema } from './verification-rules'

const rules = VerificationRulesSchema.parse({})
it.each([
  ['Test results', 'program_not_allowed'],
  ['pnpm run verify:full && echo ok', 'shell_operator'],
  ['pnpm test; echo ok', 'shell_operator'],
  ['pnpm test || echo ok', 'shell_operator'],
  ['pnpm test | cat', 'shell_operator'],
  ['pnpm test > out', 'shell_operator'],
  ['pnpm test < input', 'shell_operator'],
  ['pnpm test `pwd`', 'shell_operator'],
  ['pnpm test $(pwd)', 'shell_operator'],
  ['pnpm test\nnode test.js', 'multiline'],
  ['pnpm test\rnode test.js', 'multiline'],
  ['MODE=test pnpm test', 'program_not_allowed']
])('rejects %s as %s', (command, reason) => {
  expect(validateEvidenceCommands([command], rules)).toMatchObject([{ index: 0, reason }])
})
it('permits exact/basename programs and deliberately does not interpret arguments', () => {
  expect(
    validateEvidenceCommands(
      [
        'pnpm exec vitest run tests/example.test.ts',
        '/usr/bin/node test.js',
        './gradlew test',
        'pnpm run verify:full output with exit code 0'
      ],
      rules
    )
  ).toEqual([])
})
it('includes setup and all risk gates in the policy toolchain', () => {
  const policy = VerificationRulesSchema.parse({
    evidenceCommands: { allowedPrograms: [] },
    setupCommands: ['/tools/bootstrap --prepare'],
    repositoryGates: { high: ['node gate.js'] }
  })
  expect(allowedEvidencePrograms(policy)).toEqual(['/tools/bootstrap', 'node'])
  expect(validateEvidenceCommands(['node test.js', 'bootstrap --check'], policy)).toEqual([])
  expect(validateEvidenceCommands(['pnpm test'], policy)).toEqual([
    { index: 0, reason: 'program_not_allowed', program: 'pnpm' }
  ])
})
it('rejects invalid regex policy and defaults both additive fields for old policies', () => {
  expect(VerificationRulesSchema.safeParse({ planInvalidPatterns: ['['] }).success).toBe(false)
  expect(rules).toMatchObject({
    evidenceCommands: { allowedPrograms: expect.arrayContaining(['pnpm', './gradlew']) },
    planInvalidPatterns: expect.arrayContaining(['ERR_PNPM_NO_SCRIPT'])
  })
})
