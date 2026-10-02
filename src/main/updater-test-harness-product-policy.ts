import type * as ProductEgressPolicyModule from '../shared/product-egress-policy'
import { vi } from 'vitest'

/** Keeps opt-in scheduling regressions distinct from the shipped V1 policy tests. */
export async function enabledUpdaterPolicy(): Promise<typeof ProductEgressPolicyModule> {
  const actual = await vi.importActual<typeof ProductEgressPolicyModule>(
    '../shared/product-egress-policy'
  )
  return {
    ...actual,
    PRODUCT_EGRESS_POLICY: {
      ...actual.PRODUCT_EGRESS_POLICY,
      automaticUpdateChecks: true,
      nudgeUrl: 'https://updates.example.test/nudge.json'
    }
  }
}
