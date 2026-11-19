import { describe, expect, it } from 'vitest'
import { satisfiesOrcaEngineRange } from './plugin-manifest'

describe('Plugin engine ranges across version lines', () => {
  it('0.1.0 satisfies a range the baseline satisfies and fails a range past the baseline', () => {
    for (const hostVersion of ['0.1.0', '0.2.0', '0.1.0-rc.1', ' v0.10.0+abc ']) {
      expect(satisfiesOrcaEngineRange(hostVersion, '>=1.0.0')).toBe(true)
      expect(satisfiesOrcaEngineRange(hostVersion, '>=1.4.214')).toBe(true)
      expect(satisfiesOrcaEngineRange(hostVersion, '>=1.4.215')).toBe(false)
      expect(satisfiesOrcaEngineRange(hostVersion, '>=0.99.0')).toBe(true)
    }
  })

  it('an upstream host version is compared as before', () => {
    expect(satisfiesOrcaEngineRange('1.4.0', '>=1.0.0')).toBe(true)
    expect(satisfiesOrcaEngineRange('1.4.0', '>=1.4.0')).toBe(true)
    expect(satisfiesOrcaEngineRange('1.4.0', '>=1.4.1')).toBe(false)
    expect(satisfiesOrcaEngineRange('1.4.0-rc.1', '>=1.4.0')).toBe(true)
    expect(satisfiesOrcaEngineRange('1.4.0+abc', '>=1.4.0')).toBe(true)
    expect(satisfiesOrcaEngineRange('1.3.999', '>=1.4.0')).toBe(false)
    expect(satisfiesOrcaEngineRange('0.0.0-orcad', '>=0.0.1')).toBe(false)
  })
})
