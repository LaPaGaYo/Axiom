import { describe, expect, it } from 'vitest'
import { detectsBuildSystemFlag, swiftBuildArgs } from './build-computer-macos-swift-args.mjs'

describe('Swift build-system capability detection', () => {
  it('recognizes the build-system option in help output', () => {
    expect(
      detectsBuildSystemFlag(
        'USAGE: swift build <options>\n  --build-system <build-system>\n  --show-bin-path'
      )
    ).toBe(true)
  })

  it.each(['USAGE: swift build <options>\n  --show-bin-path', ''])(
    'does not enable the flag when help omits it (%j)',
    (helpText) => {
      expect(detectsBuildSystemFlag(helpText)).toBe(false)
    }
  )
})

describe.each(['arm64-apple-macosx', 'x86_64-apple-macosx'])(
  'Swift build argv for %s',
  (triple) => {
    const packagePath = '/workspace/Axiom checkout/native/computer-use-macos'

    it('selects native builds when the toolchain supports the flag', () => {
      expect(swiftBuildArgs({ packagePath, triple, supportsBuildSystemFlag: true })).toEqual([
        'build',
        '-c',
        'release',
        '--package-path',
        packagePath,
        '--triple',
        triple,
        '--build-system',
        'native'
      ])
    })

    it('preserves the legacy argv when the toolchain does not support the flag', () => {
      expect(swiftBuildArgs({ packagePath, triple, supportsBuildSystemFlag: false })).toEqual([
        'build',
        '-c',
        'release',
        '--package-path',
        packagePath,
        '--triple',
        triple
      ])
    })
  }
)
