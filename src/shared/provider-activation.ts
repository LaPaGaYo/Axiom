import { z } from 'zod'

export const providerActivationIdSchema = z.enum([
  'codex',
  'gh',
  'glab',
  'bitbucket',
  'azureDevOps',
  'gitea',
  'claude',
  'gemini',
  'opencode-go',
  'kimi',
  'minimax',
  'grok',
  'antigravity',
  'cursor',
  'zcode'
])
export const providerActivationsSchema = z.partialRecord(
  providerActivationIdSchema,
  z.object({
    activatedAt: z.iso.datetime(),
    source: z.enum([
      'agent-launch',
      'settings-hook-install',
      'integrations-recheck',
      'account-added'
    ])
  })
)
export type ProviderActivationId = z.infer<typeof providerActivationIdSchema>
export type ProviderActivations = z.infer<typeof providerActivationsSchema>
export type ProviderActivationSource = NonNullable<
  ProviderActivations[ProviderActivationId]
>['source']

export function normalizeProviderActivations(value: unknown): ProviderActivations {
  const parsed = providerActivationsSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}
