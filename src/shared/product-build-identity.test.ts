// @vitest-environment node
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import compatibilityContract from './local-build-compatibility-contract.json'
import packageJson from '../../package.json'
import { PRODUCT_EGRESS_POLICY } from './product-egress-policy'
// Reuse the complete policy pin, including all disabled endpoints and empty host lists.
import './product-egress-policy.test'

// The CLI build also compiles shared tests as CommonJS.
const requireFromRepository = createRequire(path.join(process.cwd(), 'package.json'))
const buildIdentity = z
  .object({
    appId: z.string(),
    productName: z.string(),
    protocols: z.array(z.object({ name: z.string(), schemes: z.array(z.string()) })),
    publish: z
      .object({
        provider: z.literal('github'),
        owner: z.string(),
        repo: z.string(),
        releaseType: z.enum(['draft', 'prerelease'])
      })
      .strict()
  })
  .parse(requireFromRepository('./config/electron-builder.config.cjs'))

describe('product build identity', () => {
  it('pins the desktop identity and bootstrap compatibility identity', () => {
    expect(buildIdentity.appId).toBe('com.lapagayo.axiom')
    expect(buildIdentity.productName).toBe('Axiom')
    expect(buildIdentity.protocols.flatMap(({ schemes }) => schemes)).toEqual(['axiom'])
    expect(compatibilityContract.appId).toBe(buildIdentity.appId)
  })

  it('publishes only to the policy release repository', () => {
    expect(buildIdentity.publish).toEqual({
      provider: 'github',
      ...PRODUCT_EGRESS_POLICY.updateFeed,
      releaseType: buildIdentity.publish.releaseType
    })
  })

  it('excludes the retired telemetry dependency from every dependency section', () => {
    const manifest = z.record(z.string(), z.unknown()).parse(packageJson)
    const overrides = z
      .object({ overrides: z.record(z.string(), z.unknown()).optional() })
      .parse(manifest.pnpm ?? {})
    for (const section of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      overrides.overrides
    ]) {
      const dependencies = z.record(z.string(), z.unknown()).parse(section ?? {})
      const retired = Object.keys(dependencies).filter(
        (name) => /(^|>)posthog-node(?:@|$)/.test(name) // vendor-egress-ratchet: allow -- assertion data
      )
      expect(retired).toEqual([])
    }
  })
})
