import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultUserDataPath } from './metadata'

afterEach(() => vi.unstubAllEnvs())

describe('product runtime metadata directory', () => {
  it.each([
    ['darwin', ['Library', 'Application Support', 'axiom']],
    ['linux', ['.config', 'axiom']]
  ] as const)('matches the packaged Axiom name on %s', (platform, parts) => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('XDG_CONFIG_HOME', undefined)
    expect(getDefaultUserDataPath(platform, '/home/user')).toBe(join('/home/user', ...parts))
  })

  it('uses the Windows app-data root', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    vi.stubEnv('APPDATA', '/app-data')
    expect(getDefaultUserDataPath('win32', '/home/user')).toBe(join('/app-data', 'axiom'))
  })

  it('keeps the instance override authoritative', () => {
    vi.stubEnv('ORCA_USER_DATA_PATH', '/custom/axiom-dev')
    expect(getDefaultUserDataPath('linux', '/home/user')).toBe('/custom/axiom-dev')
  })
})
