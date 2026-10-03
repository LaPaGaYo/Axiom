import { describe, expect, it } from 'vitest'
import { PRODUCT_EGRESS_POLICY, productReleaseRepositorySlug } from './product-egress-policy'

describe('V1 product egress policy', () => {
  it('pins the release repository and disables automatic checks and optional endpoints', () => {
    expect(PRODUCT_EGRESS_POLICY).toEqual({
      updateFeed: { owner: 'LaPaGaYo', repo: 'Axiom' },
      automaticUpdateChecks: false,
      changelogJsonUrl: null,
      changelogPageUrl: null,
      nudgeUrl: null,
      pluginKillListUrl: null,
      feedbackApiUrl: null,
      diagnosticsTokenUrl: null,
      cloudAuth: null,
      pushGatewayOrigin: null,
      artifactShareApiOrigin: null,
      skillShareHosts: []
    })
    expect(productReleaseRepositorySlug()).toBe('LaPaGaYo/Axiom')
  })
})
