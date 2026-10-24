import { z } from 'zod'
import type { TaskSpec } from './mission-objects'

const Command = z.string().trim().min(1)
const Commands = z.array(Command)
export const VerificationRulesSchema = z.strictObject({
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
  secretPatterns: z
    .array(
      z
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
    )
    .default([]),
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
export type VerificationCommand = { source: 'setup' | 'evidence' | 'gate'; command: string }

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
  task: Pick<TaskSpec, 'requiredEvidence' | 'risk'>,
  rules: VerificationRules
): VerificationCommand[] {
  const plan: VerificationCommand[] = rules.setupCommands.map((command) => ({
    source: 'setup',
    command
  }))
  const evidence = [
    ...new Set(task.requiredEvidence.map((command) => command.trim()).filter(Boolean))
  ]
  plan.push(...evidence.map((command) => ({ source: 'evidence' as const, command })))
  const listed = new Set(plan.map(({ command }) => command))
  for (const command of rules.repositoryGates[task.risk] ?? []) {
    if (!listed.has(command)) {
      plan.push({ source: 'gate', command })
      listed.add(command)
    }
  }
  return plan
}
