export const HARNESS_EGRESS_DOMAINS: Record<'codex' | 'claude', readonly string[]> = {
  codex: ['chatgpt.com', '.chatgpt.com', 'openai.com', '.openai.com'],
  claude: ['api.anthropic.com', 'platform.claude.com']
}
export const EGRESS_LOOPBACK = ['localhost', '127.0.0.1', '::1']
export const EGRESS_BLACKHOLE = 'http://127.0.0.1:9'
const PROXY_NAMES = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy'
]

export type HarnessEgressEvidence = {
  mode: 'allowlist' | 'inherited-proxy'
  noProxy: string[]
  blackhole: string | null
  overrides: string[]
}

function loopbackBlackhole(value: string): string {
  const url = URL.parse(value)
  // Checking the parsed host too rejects userinfo tricks such as localhost:9@another-host.
  if (
    !['http://127.0.0.1:', 'http://localhost:'].some((prefix) => value.startsWith(prefix)) ||
    !url ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('AXIOM_EGRESS_BLACKHOLE_URL must be a loopback HTTP URL without credentials')
  }
  return value
}

export function harnessEgressEnv(input: {
  provider: 'codex' | 'claude'
  inherited: NodeJS.ProcessEnv
  axiomEnv?: NodeJS.ProcessEnv
}): HarnessEgressEvidence & { env: Record<string, string> } {
  if (PROXY_NAMES.some((name) => Boolean(input.inherited[name]))) {
    // Do not copy inherited URLs or bypass lists into evidence: they may contain credentials.
    return { mode: 'inherited-proxy', env: {}, noProxy: [], blackhole: null, overrides: [] }
  }
  const axiomEnv = input.axiomEnv ?? process.env
  const overrides: string[] = []
  let blackhole = EGRESS_BLACKHOLE
  if (axiomEnv.AXIOM_EGRESS_BLACKHOLE_URL !== undefined) {
    blackhole = loopbackBlackhole(axiomEnv.AXIOM_EGRESS_BLACKHOLE_URL)
    overrides.push('AXIOM_EGRESS_BLACKHOLE_URL')
  }
  let bypass = [...HARNESS_EGRESS_DOMAINS[input.provider], ...EGRESS_LOOPBACK].join(',')
  if (axiomEnv.AXIOM_EGRESS_NO_PROXY !== undefined) {
    bypass = axiomEnv.AXIOM_EGRESS_NO_PROXY
    overrides.push('AXIOM_EGRESS_NO_PROXY')
  }
  return {
    mode: 'allowlist',
    env: {
      ...Object.fromEntries(PROXY_NAMES.map((name) => [name, blackhole])),
      NO_PROXY: bypass,
      no_proxy: bypass
    },
    noProxy: bypass.split(/[,\s]+/).filter(Boolean),
    blackhole,
    overrides
  }
}
