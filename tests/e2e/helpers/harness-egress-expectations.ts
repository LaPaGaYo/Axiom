import { expect } from '@stablyai/playwright-test'
import { z } from 'zod'

const PROXY_NAMES = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy'
]

export function headlessEgressEvidence(after: string | null | undefined): unknown {
  return z
    .object({ combination: z.object({ requested: z.object({ egress: z.unknown() }) }) })
    .parse(JSON.parse(after ?? 'null')).combination.requested.egress
}

export function expectHarnessEgress(input: {
  env: unknown
  evidence: unknown
  NO_PROXY: string
}): void {
  const env = z.record(z.string(), z.string().nullable()).parse(input.env)
  const evidence = z.object({ mode: z.string() }).passthrough().parse(input.evidence)
  if (evidence.mode === 'inherited-proxy') {
    const names = PROXY_NAMES.filter((name) => env[name])
    throw new Error(
      `Harness egress host prerequisite failed: inherited-proxy from ${names.join(', ') || 'proxy not observed in child'}. Run with no inherited proxy; values are withheld.`
    )
  }
  expect(evidence).toMatchObject({
    mode: 'allowlist',
    blackhole: 'http://127.0.0.1:9',
    noProxy: input.NO_PROXY.split(','),
    overrides: []
  })
  expect(env).toMatchObject({
    ...Object.fromEntries(PROXY_NAMES.map((name) => [name, 'http://127.0.0.1:9'])),
    NO_PROXY: input.NO_PROXY,
    no_proxy: input.NO_PROXY
  })
}
