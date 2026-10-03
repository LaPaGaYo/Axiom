export type ProductEgressPolicy = {
  /** GitHub repository that serves release assets and the prerelease feed. */
  readonly updateFeed: { readonly owner: string; readonly repo: string }
  /** Public source repository of this product, derived from updateFeed. */
  readonly repositoryUrl: string
  readonly issuesUrl: string
  /** Product documentation entry point; null means no docs link is rendered. */
  readonly docsUrl: string | null
  /** Community links; empty means none are rendered. */
  readonly communityLinks: readonly { readonly label: string; readonly url: string }[]
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
const repositoryUrl = `https://github.com/${updateFeed.owner}/${updateFeed.repo}`

export const PRODUCT_EGRESS_POLICY: ProductEgressPolicy = {
  updateFeed,
  repositoryUrl,
  issuesUrl: `${repositoryUrl}/issues`,
  docsUrl: `${repositoryUrl}#readme`,
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
  skillsRepositoryUrl: repositoryUrl,
  starPromptRepository: null
}

export const productReleaseRepositorySlug = (): string =>
  `${PRODUCT_EGRESS_POLICY.updateFeed.owner}/${PRODUCT_EGRESS_POLICY.updateFeed.repo}`
