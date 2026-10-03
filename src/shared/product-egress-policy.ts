export type ProductEgressPolicy = {
  /** GitHub repository that serves release assets and the prerelease feed. */
  readonly updateFeed: { readonly owner: string; readonly repo: string }
  /** When false, automatic checks are disabled; menu-initiated checks still run. */
  readonly automaticUpdateChecks: boolean
  readonly changelogJsonUrl: string | null
  readonly changelogPageUrl: string | null
  readonly nudgeUrl: string | null
  readonly pluginKillListUrl: string | null
  readonly feedbackApiUrl: string | null
  /** Official-build pinned endpoint; null disables official diagnostic uploads. */
  readonly diagnosticsTokenUrl: string | null
  /** Packaged cloud defaults; null requires explicit environment configuration. */
  readonly cloudAuth: {
    readonly apiBaseUrl: string
    readonly clientId: string
    readonly relayDirectorUrl: string
  } | null
  readonly pushGatewayOrigin: string | null
  readonly artifactShareApiOrigin: string | null
  /** Empty means only bare skill-share identifiers are accepted. */
  readonly skillShareHosts: readonly string[]
  /** Official plugin marketplace git source seeded at startup; null = no official source. */
  readonly officialPluginMarketplace: {
    readonly owner: string
    readonly repository: string
    readonly gitUrl: string
  } | null
  /** Repository agents install the bundled skills from. */
  readonly skillsRepositoryUrl: string
  /** Repository the star prompt targets; null = no star prompt. */
  readonly starPromptRepository: string | null
}

const updateFeed = { owner: 'LaPaGaYo', repo: 'Axiom' }

export const PRODUCT_EGRESS_POLICY: ProductEgressPolicy = {
  updateFeed,
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
  skillsRepositoryUrl: `https://github.com/${updateFeed.owner}/${updateFeed.repo}`,
  starPromptRepository: null
}

export const productReleaseRepositorySlug = (): string =>
  `${PRODUCT_EGRESS_POLICY.updateFeed.owner}/${PRODUCT_EGRESS_POLICY.updateFeed.repo}`
