import { describe, expect, it } from 'vitest'
import { FEATURE_WALL_TILES } from './feature-wall-tiles'
import { FEATURE_WALL_WORKFLOWS } from './feature-wall-workflows'
import {
  PRODUCT_EGRESS_POLICY,
  productReleaseRepositorySlug,
  resolveProductDocsUrl
} from './product-egress-policy'

describe('V1 product egress policy', () => {
  it('retains relative feature documentation paths without linking to an unconfigured site', () => {
    const features = [...FEATURE_WALL_TILES, ...FEATURE_WALL_WORKFLOWS]
    expect(features).toHaveLength(17)
    for (const feature of features) {
      expect(feature.docsPath).toMatch(/^\/docs\//)
      expect(resolveProductDocsUrl(feature.docsPath)).toBeNull()
    }
  })

  it('pins the release repository and disables automatic checks and optional endpoints', () => {
    expect(PRODUCT_EGRESS_POLICY).toEqual({
      updateFeed: { owner: 'LaPaGaYo', repo: 'Axiom' },
      repositoryUrl: 'https://github.com/LaPaGaYo/Axiom',
      issuesUrl: 'https://github.com/LaPaGaYo/Axiom/issues',
      docsUrl: 'https://github.com/LaPaGaYo/Axiom#readme',
      docsSiteOrigin: null,
      communityLinks: [],
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
      skillShareHosts: [],
      officialPluginMarketplace: null,
      skillsRepositoryUrl: 'https://github.com/LaPaGaYo/Axiom',
      starPromptRepository: null
    })
    expect(productReleaseRepositorySlug()).toBe('LaPaGaYo/Axiom')
  })
})
