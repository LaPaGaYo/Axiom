import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allowsArtifactCloudAuthOverride,
  resolveArtifactCloudApiUrl
} from './artifact-cloud-config'

const policy = vi.hoisted(() => {
  const value: { artifactShareApiOrigin: string | null } = { artifactShareApiOrigin: null }
  return value
})
vi.mock('../../shared/product-egress-policy', () => ({ PRODUCT_EGRESS_POLICY: policy }))
afterEach(() => {
  policy.artifactShareApiOrigin = null
})

vi.mock('electron', () => ({ app: { isPackaged: true } }))

describe('resolveArtifactCloudApiUrl', () => {
  it('is unconfigured by default', () => {
    expect(resolveArtifactCloudApiUrl(undefined, {}, true)).toBeNull()
  })

  it('allows loopback HTTP only in development', () => {
    expect(
      resolveArtifactCloudApiUrl(
        undefined,
        { ORCA_ARTIFACTS_API_URL: 'http://127.0.0.1:45961' },
        false
      )
    ).toBe('http://127.0.0.1:45961')
    expect(() => resolveArtifactCloudApiUrl('http://127.0.0.1:45961', {}, true)).toThrow(/HTTPS/)
  })

  it('rejects origins that could receive an Orca access token', () => {
    expect(() => resolveArtifactCloudApiUrl('https://example.com', {}, false)).toThrow(
      /policy host/
    )
    expect(() => resolveArtifactCloudApiUrl('https://localhost/path', {}, false)).toThrow(/origin/)
  })

  it('rejects packaged loopback HTTPS and untrusted env overrides', () => {
    expect(() => resolveArtifactCloudApiUrl('https://localhost', {}, true)).toThrow(/policy host/)
    expect(() =>
      resolveArtifactCloudApiUrl(
        undefined,
        { ORCA_ARTIFACTS_API_URL: 'https://untrusted.test' },
        true
      )
    ).toThrow(/policy host/)
  })

  it('accepts only the policy host when a future product policy configures sharing', () => {
    policy.artifactShareApiOrigin = 'https://shares.example'
    expect(resolveArtifactCloudApiUrl(undefined, {}, true)).toBe('https://shares.example')
    expect(
      resolveArtifactCloudApiUrl(
        undefined,
        { ORCA_ARTIFACTS_API_URL: 'https://shares.example:8443' },
        true
      )
    ).toBe('https://shares.example:8443')
    expect(() => resolveArtifactCloudApiUrl('https://sub.shares.example', {}, true)).toThrow(
      /policy host/
    )
  })

  it('allows auth token overrides only in non-production development builds', () => {
    expect(allowsArtifactCloudAuthOverride({}, false)).toBe(true)
    expect(allowsArtifactCloudAuthOverride({ NODE_ENV: 'production' }, false)).toBe(false)
    expect(allowsArtifactCloudAuthOverride({}, true)).toBe(false)
  })
})
