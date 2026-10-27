import { z } from 'zod'
import { AxiomIdSchema, EffortSchema, TuiAgentIdSchema } from './mission-objects'

export const ProviderFilterReasonSchema = z.enum([
  'not_installed',
  'no_account',
  'not_certified',
  'disallowed',
  'tier_too_low'
])
const permissions = {
  write: z.array(z.string().min(1)),
  network: z.literal('restricted'),
  tools: z.tuple([z.literal('shell'), z.literal('git-readonly')])
}
const common = {
  version: z.literal(1),
  missionId: AxiomIdSchema,
  provider: TuiAgentIdSchema,
  model: z.string(),
  endpointProfile: z.enum(['subscription']),
  reasoning: z.strictObject({ effort: EffortSchema }),
  permissions: z.strictObject(permissions),
  budget: z.strictObject({
    maxRuntimeMinutes: z.number().positive(),
    maxTokens: z.number().int().nonnegative().optional()
  }),
  submissionContract: z.literal('axiom-submission-v1'),
  selection: z.strictObject({
    installed: z.array(TuiAgentIdSchema),
    filtered: z.array(
      z.strictObject({ provider: TuiAgentIdSchema, reason: ProviderFilterReasonSchema })
    ),
    ranked: z.array(TuiAgentIdSchema).min(1),
    chosen: TuiAgentIdSchema,
    rationale: z.string().min(1),
    crossProvider: z
      .strictObject({ plannerProvider: TuiAgentIdSchema.nullable(), applied: z.boolean() })
      .optional(),
    roleProviderUnavailable: ProviderFilterReasonSchema.optional()
  })
}

export const AgentSpecSchema = z.discriminatedUnion('role', [
  z.strictObject({
    ...common,
    role: z.literal('worker'),
    taskId: AxiomIdSchema,
    contextPackageId: AxiomIdSchema,
    acceptanceCriteria: z.array(z.string()),
    capabilities: z.array(z.string().min(1)),
    workspace: z.strictObject({ strategy: z.literal('attempt-worktree') })
  }),
  z.strictObject({
    ...common,
    role: z.literal('planner'),
    goalRevisionId: AxiomIdSchema,
    capabilities: z.tuple([z.literal('planning')]),
    permissions: z.strictObject({ ...permissions, write: z.tuple([]) }),
    workspace: z.strictObject({ strategy: z.literal('planner-worktree') })
  })
])
export type AgentSpec = z.infer<typeof AgentSpecSchema>

export function canonicalAgentSpec(spec: unknown): string {
  return JSON.stringify(AgentSpecSchema.parse(spec))
}
