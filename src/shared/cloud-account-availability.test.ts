import { describe, expect, it } from 'vitest'
import { CLOUD_ACCOUNT_AVAILABLE } from './cloud-account-availability'
import { PRODUCT_EGRESS_POLICY } from './product-egress-policy'

describe('cloud account availability', () => {
  it('is derived from the packaged cloud sign-in defaults', () => {
    expect(CLOUD_ACCOUNT_AVAILABLE).toBe(PRODUCT_EGRESS_POLICY.cloudAuth !== null)
  })

  it('is unavailable in this build', () => {
    expect(CLOUD_ACCOUNT_AVAILABLE).toBe(false)
  })
})
