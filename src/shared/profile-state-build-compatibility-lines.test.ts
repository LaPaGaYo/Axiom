import { describe, expect, it } from 'vitest'
import { profileStateBuildCompatibilityError } from './profile-state-build-compatibility'

describe('SQLite profile compatibility across version lines', () => {
  it('0.1.0 may switch to a later 0.x and to an upstream build at or past the floor', () => {
    for (const targetVersion of ['0.2.0', '0.10.0-rc.1', '1.4.214', '1.4.215', '1.4.215-rc.1']) {
      expect(profileStateBuildCompatibilityError('0.1.0', targetVersion)).toBeNull()
    }
  })

  it('0.1.0 refuses a build from before the floor', () => {
    for (const targetVersion of ['1.4.213', '1.4.214-rc.1', '0.0.0-orcad', 'invalid']) {
      expect(profileStateBuildCompatibilityError('0.1.0', targetVersion)).toContain('--profile-id')
    }
  })

  it('a build at the floor may switch to 0.1.0', () => {
    for (const targetVersion of ['0.1.0', '0.1.0-rc.1', ' v0.1.0+abc ']) {
      expect(profileStateBuildCompatibilityError('1.4.214', targetVersion)).toBeNull()
    }
  })
})
