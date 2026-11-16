import { expect, it } from 'vitest'
import {
  VerificationRulesSchema,
  matchesRetryOnce,
  matchesKnownFlaky,
  resolveIntegrationPlan,
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
    knownFlaky: [],
    secretPatterns: []
  })
  expect(rules.testPathPatterns).toEqual([
    '**/*.test.*',
    '**/*.spec.*',
    '**/__tests__/**',
    '**/test_*.py',
    '**/*_test.py',
    '**/*_test.go'
  ])
  expect(rules.dangerousPathPatterns).toEqual([
    '.github/workflows/**',
    '.github/actions/**',
    '.gitlab-ci.yml',
    '.circleci/**',
    '.husky/**',
    '.pre-commit-config.yaml',
    '**/lefthook.yml',
    '**/package.json',
    '**/pnpm-lock.yaml',
    '**/pnpm-workspace.yaml',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/.npmrc',
    '**/vitest.config.*',
    '**/vitest.workspace.*',
    '**/jest.config.*',
    '**/playwright.config.*',
    '**/eslint.config.*',
    '**/.eslintrc*',
    '**/.oxlintrc*',
    '**/AGENTS.md',
    '**/CLAUDE.md',
    '**/.claude/**',
    '**/.codex/**',
    '**/.agents/**',
    '**/.mcp.json',
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

it('replaces test path defaults, including an empty list, and rejects non-string patterns', () => {
  for (const testPathPatterns of [[], ['checks/**']]) {
    expect(VerificationRulesSchema.parse({ testPathPatterns }).testPathPatterns).toEqual(
      testPathPatterns
    )
  }
  expect(VerificationRulesSchema.safeParse({ testPathPatterns: [1] }).success).toBe(false)
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
    resolveVerificationPlan(
      { risk: 'high', acceptanceCriteria: [], requiredEvidence: [' test ', 'test', 'check'] },
      rules
    )
  ).toEqual([
    { source: 'setup', command: 'setup', criteria: [] },
    { source: 'setup', command: 'setup', criteria: [] },
    { source: 'evidence', command: 'test', criteria: [0] },
    { source: 'evidence', command: 'check', criteria: [1] },
    { source: 'gate', command: 'gate', criteria: [] }
  ])
  expect(
    resolveVerificationPlan(
      { risk: 'low', acceptanceCriteria: [], requiredEvidence: [] },
      VerificationRulesSchema.parse({})
    )
  ).toEqual([])
})

it('trims required evidence and skips empty items before de-duplicating', () => {
  const rules = VerificationRulesSchema.parse({ repositoryGates: { low: ['test', 'gate'] } })
  expect(
    resolveVerificationPlan(
      {
        risk: 'low',
        acceptanceCriteria: [],
        requiredEvidence: [' ', '\n\t', ' test ', 'test', ' check ', '\r\n']
      },
      rules
    )
  ).toEqual([
    { source: 'evidence', command: 'test', criteria: [0] },
    { source: 'evidence', command: 'check', criteria: [1] },
    { source: 'gate', command: 'gate', criteria: [] }
  ])
  expect(
    resolveVerificationPlan(
      { risk: 'low', acceptanceCriteria: [], requiredEvidence: [' ', '\n\t'] },
      VerificationRulesSchema.parse({})
    )
  ).toEqual([])
})

it('validates additive regex sources without flags and replaces dangerous defaults', () => {
  expect(
    VerificationRulesSchema.parse({
      secretPatterns: ['^custom_[0-9]+$'],
      dangerousPathPatterns: []
    })
  ).toMatchObject({ secretPatterns: ['^custom_[0-9]+$'], dangerousPathPatterns: [] })
  for (const secretPatterns of [['('], [''], [1]]) {
    expect(VerificationRulesSchema.safeParse({ secretPatterns }).success).toBe(false)
  }
})

it('links shared commands to every criterion while preserving criterion order', () => {
  const rules = VerificationRulesSchema.parse({
    setupCommands: ['setup'],
    repositoryGates: { low: ['pnpm test', 'gate'] }
  })
  expect(
    resolveVerificationPlan(
      {
        risk: 'low',
        acceptanceCriteria: [
          { text: 'One', check: { kind: 'command', command: 'pnpm test' } },
          { text: 'Deliverable', check: { kind: 'artifact' } },
          { text: 'Two', check: { kind: 'command', command: 'pnpm test' } },
          { text: 'Review', check: { kind: 'human' } },
          { text: 'Types', check: { kind: 'command', command: 'pnpm tc' } }
        ]
      },
      rules
    )
  ).toEqual([
    { source: 'setup', command: 'setup', criteria: [] },
    { source: 'evidence', command: 'pnpm test', criteria: [0, 2] },
    { source: 'evidence', command: 'pnpm tc', criteria: [4] },
    { source: 'gate', command: 'gate', criteria: [] }
  ])
})

it('keeps an absent integrationGates apart from an empty list and rejects a bad command', () => {
  expect('integrationGates' in VerificationRulesSchema.parse({})).toBe(false)
  expect(VerificationRulesSchema.safeParse({ integrationGates: [] }).success).toBe(true)
  expect(VerificationRulesSchema.parse({ integrationGates: [] }).integrationGates).toEqual([])
  expect(
    VerificationRulesSchema.parse({ integrationGates: [' pnpm test '] }).integrationGates
  ).toEqual(['pnpm test'])
  for (const integrationGates of [[''], [' '], 'pnpm test', [1]]) {
    expect(VerificationRulesSchema.safeParse({ integrationGates }).success).toBe(false)
  }
  expect(VerificationRulesSchema.safeParse({ integrationGates: [], unknown: [] }).success).toBe(
    false
  )
})

it('resolves the integration plan as setup, criterion commands and integration gates', () => {
  const task = {
    risk: 'low' as const,
    acceptanceCriteria: [
      { text: 'One', check: { kind: 'command' as const, command: 'pnpm test' } },
      { text: 'Two', check: { kind: 'command' as const, command: 'pnpm test' } },
      { text: 'Types', check: { kind: 'command' as const, command: 'pnpm tc' } }
    ]
  }
  const rules = VerificationRulesSchema.parse({
    setupCommands: ['pnpm setup', 'pnpm test'],
    integrationGates: ['pnpm test', 'pnpm lint', 'pnpm build', 'pnpm lint', 'pnpm setup'],
    repositoryGates: { low: ['pnpm other'], high: ['pnpm full'] }
  })
  const common = [
    { source: 'setup', command: 'pnpm setup', criteria: [] },
    { source: 'setup', command: 'pnpm test', criteria: [] },
    { source: 'evidence', command: 'pnpm test', criteria: [0, 1] },
    { source: 'evidence', command: 'pnpm tc', criteria: [2] }
  ]
  expect(resolveIntegrationPlan(task, rules)).toEqual([
    ...common,
    { source: 'gate', command: 'pnpm lint', criteria: [] },
    { source: 'gate', command: 'pnpm build', criteria: [] }
  ])
  expect(resolveIntegrationPlan(task, rules).filter((step) => step.source === 'evidence')).toEqual(
    resolveVerificationPlan(task, rules).filter((step) => step.source === 'evidence')
  )
  expect(resolveIntegrationPlan(task, { ...rules, integrationGates: [] })).toEqual(common)
})

it('takes the highest configured risk tier when integrationGates is absent', () => {
  for (const [repositoryGates, gates] of [
    [{ high: ['high gate'], low: ['low gate'] }, ['high gate']],
    [{ medium: ['medium gate'], low: ['low gate'] }, ['medium gate']],
    [{ low: ['low gate'] }, ['low gate']],
    [{ high: [], low: ['low gate'] }, []],
    [{}, []]
  ] as const) {
    for (const risk of ['low', 'high'] as const) {
      expect(
        resolveIntegrationPlan(
          { risk, acceptanceCriteria: [] },
          VerificationRulesSchema.parse({ repositoryGates })
        )
      ).toEqual(gates.map((command) => ({ source: 'gate', command, criteria: [] })))
    }
  }
})

it('keeps the verification plan of every risk unchanged when integrationGates is set', () => {
  const rules = VerificationRulesSchema.parse({
    setupCommands: ['setup', 'setup'],
    repositoryGates: {
      low: ['test', 'low gate', 'setup'],
      medium: ['test', 'medium gate', 'setup'],
      high: ['test', 'high gate', 'setup']
    }
  })
  const common = [
    { source: 'setup', command: 'setup', criteria: [] },
    { source: 'setup', command: 'setup', criteria: [] },
    { source: 'evidence', command: 'test', criteria: [0] },
    { source: 'evidence', command: 'check', criteria: [1] }
  ]
  const expected = {
    low: [...common, { source: 'gate', command: 'low gate', criteria: [] }],
    medium: [...common, { source: 'gate', command: 'medium gate', criteria: [] }],
    high: [...common, { source: 'gate', command: 'high gate', criteria: [] }]
  }
  for (const risk of ['low', 'medium', 'high'] as const) {
    const task = { risk, acceptanceCriteria: [], requiredEvidence: [' test ', 'test', 'check'] }
    expect(resolveVerificationPlan(task, rules)).toEqual(expected[risk])
    for (const integrationGates of [[], ['integration gate']]) {
      expect(
        resolveVerificationPlan(task, VerificationRulesSchema.parse({ ...rules, integrationGates }))
      ).toEqual(expected[risk])
    }
  }
})
