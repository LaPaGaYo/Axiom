import { app } from 'electron'

import { PRODUCT_EGRESS_POLICY } from '../../shared/product-egress-policy'

function isPackaged(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

export function resolveArtifactCloudApiUrl(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): string | null {
  const candidate = override?.trim() || env.ORCA_ARTIFACTS_API_URL?.trim()
  const origin = candidate || PRODUCT_EGRESS_POLICY.artifactShareApiOrigin
  if (!origin) {
    return null
  }
  const url = new URL(origin)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  const policyOrigin = PRODUCT_EGRESS_POLICY.artifactShareApiOrigin
  const firstParty = policyOrigin !== null && url.hostname === new URL(policyOrigin).hostname
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !packaged)) {
    throw new Error('Artifact API URLs must use HTTPS; local development may use loopback HTTP.')
  }
  if (!firstParty && !(loopback && !packaged)) {
    throw new Error('Artifact API URLs must use the policy host or a development loopback host.')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Artifact API URL must be an origin without credentials, paths, or parameters.')
  }
  return url.origin
}

export function allowsArtifactCloudAuthOverride(
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): boolean {
  return env.NODE_ENV !== 'production' && !packaged
}
