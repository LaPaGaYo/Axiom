import { expect, it } from 'vitest'
import {
  VerificationRulesSchema,
  matchesRetryOnce,
  matchesKnownFlaky,
  resolveVerificationPlan
} from './verification-rules'

it('defaults all supported keys and rejects unknown keys and invalid commands', () => {
  const rules = VerificationRulesSchema.parse({})
  expect(rules).toMatchObject({
    repositoryGates: {},
    timeBudgetMinutes: 30,
    inconclusiveRouting: 'specialist',
    nonCodeTasks: 'human_confirm',
    setupCommands: [],
    knownFlaky: []
  })
  expect(rules.dangerousPathPatterns).toEqual([
    '.github/workflows/**',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'package.json',
    '.axiom-work/**'
  ])
  expect(rules.retryOnce).toEqual([
    'pnpm test',
    'pnpm run test',
    'npm test',
    'npm run test',
    'yarn test',
    'yarn run test',
    'bun test',
    'bun run test',
    'npx vitest',
    'vitest',
    'npx jest',
    'jest',
    'pytest',
    'python -m pytest',
    'go test',
    'cargo test'
  ])
  for (const value of [
    { commands: [] },
    { repositoryGates: { other: [] } },
    { timeBudgetMinutes: 0 },
    { timeBudgetMinutes: 0.1 },
    { setupCommands: ['   '] },
    { retryOnce: [''] },
    { repositoryGates: { low: [4] } },
    { knownFlaky: 1 }
  ]) {
    expect(VerificationRulesSchema.safeParse(value).success).toBe(false)
  }
  expect(
    VerificationRulesSchema.parse({ setupCommands: [' node --version '] }).setupCommands
  ).toEqual(['node --version'])
})

it.each([
  ['pnpm run test', true],
  [' pnpm  run\ttest:unit ', true],
  ['pnpm test --run', true],
  ['pnpm run tests', false],
  ['pnpm run verify:full', false],
  ['pnpm lint', false],
  ['pnpm build', false],
  ['pnpm typecheck', false]
])('retry prefix %s matches: %s', (command, expected) => {
  expect(matchesRetryOnce(command, VerificationRulesSchema.parse({}).retryOnce)).toBe(expected)
})

it('matches only literal text and star wildcards in knownFlaky', () => {
  expect(matchesKnownFlaky('src/a.test.ts > suite > test', ['src/* > suite*'])).toBe(true)
  expect(matchesKnownFlaky('a[1].ts > test', ['a[1].ts > *'])).toBe(true)
  expect(matchesKnownFlaky('a1.ts > test', ['a[1].ts > *'])).toBe(false)
  expect(matchesKnownFlaky('test?', ['test?'])).toBe(true)
  expect(matchesKnownFlaky('testa', ['test?'])).toBe(false)
})

it('resolves setup then unique evidence then additional risk gates in declaration order', () => {
  const rules = VerificationRulesSchema.parse({
    setupCommands: ['setup', 'setup'],
    repositoryGates: { high: ['test', 'gate', 'gate', 'setup'] }
  })
  expect(
    resolveVerificationPlan({ risk: 'high', requiredEvidence: [' test ', 'test', 'check'] }, rules)
  ).toEqual([
    { source: 'setup', command: 'setup' },
    { source: 'setup', command: 'setup' },
    { source: 'evidence', command: 'test' },
    { source: 'evidence', command: 'check' },
    { source: 'gate', command: 'gate' }
  ])
  expect(
    resolveVerificationPlan(
      { risk: 'low', requiredEvidence: [] },
      VerificationRulesSchema.parse({})
    )
  ).toEqual([])
})
