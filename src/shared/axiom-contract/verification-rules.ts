import { z } from 'zod'
import type { TaskSpec } from './mission-objects'
import { acceptanceCommands, resolveAcceptance } from './acceptance'

const Command = z.string().trim().min(1)
const Commands = z.array(Command)
const RegexSource = z
  .string()
  .min(1)
  .refine((source) => {
    try {
      new RegExp(source)
      return true
    } catch {
      return false
    }
  }, 'Invalid regular expression')
const EvidenceCommandsSchema = z.strictObject({
  allowedPrograms: z
    .array(z.string().trim().min(1))
    .default([
      'pnpm',
      'npm',
      'npx',
      'yarn',
      'bun',
      'node',
      'pytest',
      'python',
      'python3',
      'go',
      'cargo',
      'make',
      'dotnet',
      'mvn',
      'gradle',
      './gradlew'
    ])
})
export const VerificationRulesSchema = z.strictObject({
  evidenceCommands: EvidenceCommandsSchema.default(() => EvidenceCommandsSchema.parse({})),
  planInvalidPatterns: z
    .array(RegexSource)
    .default([
      'ERR_PNPM_NO_SCRIPT',
      'Missing script:',
      'No test files found',
      'error: unknown command',
      'Unknown command'
    ]),
  repositoryGates: z
    .strictObject({
      low: Commands.optional(),
      medium: Commands.optional(),
      high: Commands.optional()
    })
    .default({}),
  timeBudgetMinutes: z.number().int().positive().default(30),
  inconclusiveRouting: z.enum(['specialist', 'human']).default('specialist'),
  nonCodeTasks: z.enum(['artifact_only', 'human_confirm']).default('human_confirm'),
  testPathPatterns: z
    .array(z.string())
    .default([
      '**/*.test.*',
      '**/*.spec.*',
      '**/__tests__/**',
      '**/test_*.py',
      '**/*_test.py',
      '**/*_test.go'
    ]),
  dangerousPathPatterns: z
    .array(z.string())
    .default([
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
    ]),
  secretPatterns: z.array(RegexSource).default([]),
  setupCommands: Commands.default([]),
  retryOnce: Commands.default([
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
  ]),
  knownFlaky: z.array(z.string()).default([])
})
export type VerificationRules = z.infer<typeof VerificationRulesSchema>
export type VerificationCommand = {
  source: 'setup' | 'evidence' | 'gate'
  command: string
  criteria: number[]
}

export function matchesRetryOnce(command: string, prefixes: string[]): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ')
  return prefixes.some((value) => {
    const prefix = value.trim().replace(/\s+/g, ' ')
    return (
      normalized === prefix ||
      normalized.startsWith(`${prefix} `) ||
      normalized.startsWith(`${prefix}:`)
    )
  })
}

export function matchesKnownFlaky(failure: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\S]*')}$`
    ).test(failure)
  )
}

export function resolveVerificationPlan(
  task: Pick<TaskSpec, 'acceptanceCriteria' | 'requiredEvidence' | 'risk'>,
  rules: VerificationRules
): VerificationCommand[] {
  const plan: VerificationCommand[] = rules.setupCommands.map((command) => ({
    source: 'setup',
    command,
    criteria: []
  }))
  const criteria = resolveAcceptance(task)
  for (const command of acceptanceCommands(criteria)) {
    plan.push({
      source: 'evidence',
      command,
      criteria: criteria.flatMap((criterion, index) =>
        criterion.check.kind === 'command' && criterion.check.command.trim() === command
          ? [index]
          : []
      )
    })
  }
  const listed = new Set(plan.map(({ command }) => command))
  for (const command of rules.repositoryGates[task.risk] ?? []) {
    if (!listed.has(command)) {
      plan.push({ source: 'gate', command, criteria: [] })
      listed.add(command)
    }
  }
  return plan
}
