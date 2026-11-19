import { describe, expect, it } from 'vitest'
import type { OrcadActivationRecord } from '../managed-server/activation/orcad-activation-record'
import { refuseOrcadHostDowngrade } from './orcad-host-version-admission'

const activeRecord: OrcadActivationRecord = {
  schemaVersion: 1,
  active: 'served-build',
  previous: 'previous-build',
  activatedAt: '2026-11-18T00:00:00.000Z',
  snapshot: null
}
const candidateVersion = 'candidate-build'

describe('Orcad host version admission across lines', () => {
  it('a host the baseline release served admits 0.1.0', () => {
    for (const activeAppVersion of ['1.4.214', '1.4.200']) {
      expect(
        refuseOrcadHostDowngrade({ ...activeRecord, activeAppVersion }, candidateVersion, '0.1.0')
      ).toBeNull()
    }
  })

  it('a host a newer upstream release served refuses 0.1.0', () => {
    expect(
      refuseOrcadHostDowngrade(
        { ...activeRecord, activeAppVersion: '1.4.300' },
        candidateVersion,
        '0.1.0'
      )
    ).toBe('host-newer')
  })

  it('a host a newer 0.x served refuses an older 0.x and admits a newer one', () => {
    const record = { ...activeRecord, activeAppVersion: '0.2.0' }
    expect(refuseOrcadHostDowngrade(record, candidateVersion, '0.1.0')).toBe('host-newer')
    expect(refuseOrcadHostDowngrade(record, candidateVersion, '0.3.0')).toBeNull()
  })

  it('upstream versions on both sides are refused and admitted as before', () => {
    const cases = [
      ['1.5.0', '1.4.0', 'host-newer'],
      ['1.4.0', '1.5.0', null],
      ['1.4.214', '1.4.214', null],
      ['2.0.0', '1.5.0', 'host-newer'],
      ['1.4.214', '0.0.1', 'host-newer'],
      ['0.0.0-orcad', '1.4.214', null],
      ['1.4.214', '0.0.0-orcad', 'host-newer'],
      ['1.4.214-rc.1', '1.4.214', null],
      ['invalid', '1.4.214', null]
    ] as const
    for (const [activeAppVersion, appVersion, expected] of cases) {
      expect(
        refuseOrcadHostDowngrade(
          { ...activeRecord, activeAppVersion },
          candidateVersion,
          appVersion
        )
      ).toBe(expected)
    }
  })

  it('a stopped host restarting the same build and a record without a version are admitted', () => {
    expect(
      refuseOrcadHostDowngrade(
        { ...activeRecord, active: null, previous: candidateVersion, activeAppVersion: '9.9.9' },
        candidateVersion,
        '0.1.0'
      )
    ).toBeNull()
    expect(refuseOrcadHostDowngrade(activeRecord, candidateVersion, '0.1.0')).toBeNull()
    expect(
      refuseOrcadHostDowngrade({ ...activeRecord, activeAppVersion: '' }, candidateVersion, '0.1.0')
    ).toBeNull()
  })
})
