import { describe, expect, it } from 'vitest'
import { harnessEgressEnv } from './harness-egress-env'

const proxies = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']
const blackhole = 'http://127.0.0.1:9'

describe('harness egress environment', () => {
  it.each([
    ['codex', 'chatgpt.com,.chatgpt.com,openai.com,.openai.com,localhost,127.0.0.1,::1'],
    ['claude', 'api.anthropic.com,platform.claude.com,localhost,127.0.0.1,::1']
  ] as const)('pins exactly the %s domains and loopback in both spellings', (provider, noProxy) => {
    const inherited = { NO_PROXY: '*', no_proxy: '*' }
    const result = harnessEgressEnv({ provider, inherited, axiomEnv: {} })
    expect(result).toEqual({
      mode: 'allowlist',
      env: {
        ...Object.fromEntries(proxies.map((name) => [name, blackhole])),
        NO_PROXY: noProxy,
        no_proxy: noProxy
      },
      noProxy: noProxy.split(','),
      blackhole,
      overrides: []
    })
    expect(inherited).toEqual({ NO_PROXY: '*', no_proxy: '*' })
  })

  it.each(proxies)('preserves an inherited %s without exposing its value', (name) => {
    const inherited = { [name]: 'inherited-proxy-value', NO_PROXY: 'inherited-bypass' }
    expect(
      harnessEgressEnv({
        provider: 'codex',
        inherited,
        axiomEnv: {
          AXIOM_EGRESS_BLACKHOLE_URL: 'invalid-unused-hook',
          AXIOM_EGRESS_NO_PROXY: '*'
        }
      })
    ).toEqual({ mode: 'inherited-proxy', env: {}, noProxy: [], blackhole: null, overrides: [] })
    expect(inherited[name]).toBe('inherited-proxy-value')
  })

  it.each(proxies)('treats an empty %s as unset', (name) => {
    expect(
      harnessEgressEnv({ provider: 'claude', inherited: { [name]: '' }, axiomEnv: {} }).mode
    ).toBe('allowlist')
  })

  it.each(['http://127.0.0.1:12345', 'http://localhost:8080'])('routes evidence to %s', (url) => {
    const result = harnessEgressEnv({
      provider: 'codex',
      inherited: {},
      axiomEnv: { AXIOM_EGRESS_BLACKHOLE_URL: url }
    })
    expect(result.blackhole).toBe(url)
    expect(result.overrides).toEqual(['AXIOM_EGRESS_BLACKHOLE_URL'])
    for (const name of proxies) {
      expect(result.env[name]).toBe(url)
    }
  })

  it.each(['', 'example.test, .example.test localhost'])(
    'preserves the NO_PROXY override verbatim: %j',
    (value) => {
      const result = harnessEgressEnv({
        provider: 'claude',
        inherited: {},
        axiomEnv: {
          AXIOM_EGRESS_BLACKHOLE_URL: 'http://localhost:8080',
          AXIOM_EGRESS_NO_PROXY: value
        }
      })
      expect(result.env.NO_PROXY).toBe(value)
      expect(result.env.no_proxy).toBe(value)
      expect(result.noProxy).toEqual(value.split(/[,\s]+/).filter(Boolean))
      expect(result.overrides).toEqual(['AXIOM_EGRESS_BLACKHOLE_URL', 'AXIOM_EGRESS_NO_PROXY'])
    }
  )

  it('does not take verifier hooks from the inherited shell', () => {
    const result = harnessEgressEnv({
      provider: 'codex',
      inherited: {
        AXIOM_EGRESS_BLACKHOLE_URL: 'http://localhost:8080',
        AXIOM_EGRESS_NO_PROXY: '*'
      },
      axiomEnv: {}
    })
    expect(result.blackhole).toBe(blackhole)
    expect(result.env.NO_PROXY).not.toBe('*')
    expect(result.overrides).toEqual([])
  })

  it.each([
    '',
    'https://127.0.0.1:9',
    'http://example.test:9',
    'http://localhost.evil.test:9',
    'http://127.0.0.1:9@elsewhere.test',
    'http://localhost:bad',
    'http://localhost:8080@127.0.0.1:9'
  ])('refuses invalid or non-loopback overrides without echoing the value: %j', (url) => {
    expect(() =>
      harnessEgressEnv({
        provider: 'codex',
        inherited: {},
        axiomEnv: { AXIOM_EGRESS_BLACKHOLE_URL: url }
      })
    ).toThrow('AXIOM_EGRESS_BLACKHOLE_URL must be a loopback HTTP URL without credentials')
  })
})
