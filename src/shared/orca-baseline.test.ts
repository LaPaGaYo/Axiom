import { describe, expect, it } from 'vitest'
import {
  ORCA_BASELINE,
  compareAppVersionsAcrossLines,
  isAxiomLineVersion,
  upstreamLineVersion
} from './orca-baseline'

describe('Orca baseline version lines', () => {
  it('the baseline names a release and a full commit id', () => {
    expect(ORCA_BASELINE).toEqual({
      version: '1.4.214',
      commit: '41661e33128c3a308a570aa0ed96ce24910a98c4'
    })
    expect(ORCA_BASELINE.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('0.1.0 and later 0.x versions are on the Axiom line and placeholders and 1.x versions are not', () => {
    for (const version of [
      '0.1.0',
      '0.2.0',
      '0.10.0+abc',
      '0.1.0-rc.1',
      'v0.1.0',
      ' V0.1.0-rc.1+abc ',
      '00.01.0'
    ]) {
      expect(isAxiomLineVersion(version)).toBe(true)
      expect(upstreamLineVersion(version)).toBe(ORCA_BASELINE.version)
    }
    for (const version of [
      '1.4.214',
      '1.0.0',
      '2.0.0',
      '0.0.1',
      '0.0.999',
      '0.0.0-orcad',
      ' v0.0.1 ',
      'invalid',
      '',
      '0.1',
      '0.1.0 trailing',
      '0.1.0-',
      '-0.1.0'
    ]) {
      expect(isAxiomLineVersion(version)).toBe(false)
      expect(upstreamLineVersion(version)).toBe(version)
    }
  })

  it('two versions on the same line compare as app versions', () => {
    const cases = [
      ['0.1.0', '0.2.0', -1],
      ['0.10.0', '0.2.0', 1],
      ['0.1.0-rc.1', '0.1.0', -1],
      ['0.1.0-rc.2', '0.1.0-rc.10', -1],
      [' v0.1.0+abc ', '0.1.0+def', 0],
      ['1.4.214', '1.4.300', -1],
      ['2.0.0', '1.4.214', 1],
      ['1.4.214-rc.1', '1.4.214', -1],
      ['1.4.214+abc', '1.4.214+def', 0],
      ['0.0.0-orcad', '0.0.0', -1],
      ['0.0.1', '1.0.0', -1],
      ['invalid', '1.4.214', 0]
    ] as const
    for (const [left, right, sign] of cases) {
      expect(Math.sign(compareAppVersionsAcrossLines(left, right))).toBe(sign)
    }
  })

  it('an Axiom-line version meets an upstream version at the baseline', () => {
    for (const version of ['0.1.0', '0.2.0', ' v0.10.0-rc.1+abc ']) {
      expect(compareAppVersionsAcrossLines(version, '1.4.214')).toBe(0)
      expect(compareAppVersionsAcrossLines('1.4.214', version)).toBe(0)
      expect(compareAppVersionsAcrossLines(version, '1.4.213')).toBeGreaterThan(0)
      expect(compareAppVersionsAcrossLines('1.4.213', version)).toBeLessThan(0)
      expect(compareAppVersionsAcrossLines(version, '1.4.215')).toBeLessThan(0)
      expect(compareAppVersionsAcrossLines('1.4.215', version)).toBeGreaterThan(0)
      expect(compareAppVersionsAcrossLines(version, '1.4.214-rc.1')).toBeGreaterThan(0)
      expect(compareAppVersionsAcrossLines(version, '0.0.0-orcad')).toBeGreaterThan(0)
      expect(compareAppVersionsAcrossLines(version, 'invalid')).toBe(0)
      expect(compareAppVersionsAcrossLines('invalid', version)).toBe(0)
    }
  })
})
