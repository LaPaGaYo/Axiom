import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveDiagnosticBuildTokenEndpoint,
  resolveDiagnosticTokenEndpoint
} from './diagnostic-upload-endpoint'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('diagnostic upload endpoint policy', () => {
  it.each(['stable', 'rc'] as const)(
    'disables the %s endpoint despite runtime overrides',
    (identity) => {
      const fetcher = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', fetcher)
      vi.stubGlobal('ORCA_BUILD_IDENTITY', identity)
      vi.stubGlobal('ORCA_DIAGNOSTICS_TOKEN_URL', 'https://obsolete.example.test/token')
      vi.stubEnv('ORCA_DIAGNOSTICS_TOKEN_URL', 'https://developer.example.test/token')
      expect(resolveDiagnosticBuildTokenEndpoint()).toBeNull()
      expect(resolveDiagnosticTokenEndpoint()).toBeNull()
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it('preserves the developer env override for unofficial builds', () => {
    vi.stubGlobal('ORCA_BUILD_IDENTITY', null)
    vi.stubEnv('ORCA_DIAGNOSTICS_TOKEN_URL', 'http://localhost:8080/token')
    expect(resolveDiagnosticTokenEndpoint()).toBe('http://localhost:8080/token')
    vi.stubEnv('ORCA_DIAGNOSTICS_TOKEN_URL', '')
    expect(resolveDiagnosticTokenEndpoint()).toBeNull()
  })
})
