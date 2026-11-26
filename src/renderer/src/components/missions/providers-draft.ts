import type { z } from 'zod'
import type { Policy, RoutingPolicySchema } from '../../../../shared/axiom-contract/mission-objects'
import {
  PolicyUpdateParams,
  type ProviderEligibilitySchema
} from '../../../../shared/axiom-contract/policy-params'

type RoutingInput = z.input<typeof RoutingPolicySchema>

export type ProviderEligibility = z.infer<typeof ProviderEligibilitySchema>
export type ProvidersDraft = {
  planner: string | null
  worker: string | null
  disallowed: string[]
  certified: boolean
}
export const PROVIDER_FIELDS = ['planner', 'worker', 'disallowed', 'certified'] as const

export function openProvidersDraft(routing?: Policy['routing'] | null): ProvidersDraft {
  return {
    planner: routing?.roles.planner?.provider ?? null,
    worker: routing?.roles.worker?.provider ?? null,
    disallowed: [...(routing?.disallowedProviders ?? [])],
    certified: routing?.requireCertified ?? false
  }
}

export function listProviders(
  routing: Policy['routing'] | null | undefined,
  providers: readonly ProviderEligibility[] | null | undefined
) {
  const ids = [
    ...(providers?.map(({ provider }) => provider) ?? []),
    routing?.roles.planner?.provider,
    routing?.roles.worker?.provider,
    ...(routing?.disallowedProviders ?? [])
  ]
  return [...new Set(ids.filter((id) => id !== undefined))]
}

export function roleProviderUnavailable(
  role: 'planner' | 'worker',
  provider: string | null,
  providers: readonly ProviderEligibility[] | null | undefined
) {
  const entry = provider ? providers?.find((item) => item.provider === provider) : undefined
  return entry
    ? role === 'planner'
      ? !entry.planner.eligible
      : Object.values(entry.worker).some((slot) => !slot.eligible)
    : false
}

export function buildProvidersUpdate(
  missionId: string,
  policy: Policy | null,
  opened: ProvidersDraft,
  draft: ProvidersDraft
) {
  const changed = PROVIDER_FIELDS.filter((field) => {
    if (field !== 'disallowed') {
      return draft[field] !== opened[field]
    }
    const before = new Set(opened.disallowed)
    const after = new Set(draft.disallowed)
    return before.size !== after.size || [...before].some((provider) => !after.has(provider))
  })
  if (!policy || !changed.length) {
    return { changed, params: null, error: null }
  }
  const roles: NonNullable<RoutingInput['roles']> = { ...policy.routing.roles }
  const routing: RoutingInput = { ...policy.routing, roles }
  for (const role of ['planner', 'worker'] as const) {
    if (!changed.includes(role)) {
      continue
    }
    const next = { ...roles[role] }
    const provider = draft[role]
    if (provider === null) {
      delete next.provider
    } else {
      next.provider = provider
    }
    if (Object.keys(next).length) {
      roles[role] = next
    } else {
      delete roles[role]
    }
  }
  if (changed.includes('disallowed')) {
    routing.disallowedProviders = [...draft.disallowed]
  }
  if (changed.includes('certified')) {
    routing.requireCertified = draft.certified
  }
  const parsed = PolicyUpdateParams.safeParse({ missionId, patch: { routing } })
  return {
    changed,
    params: parsed.success ? parsed.data : null,
    error: parsed.success ? null : parsed.error.issues[0]?.message
  }
}
