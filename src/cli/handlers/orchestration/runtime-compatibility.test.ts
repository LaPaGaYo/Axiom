import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isDevCliInvocation,
  resolveCompatibilityCliCommand,
  resolvePackagedWindowsCompatibilityCommand
} from './runtime-compatibility'

afterEach(() => vi.unstubAllEnvs())

describe('Axiom CLI compatibility identity', () => {
  it.each(['axiom', 'axiom-dev', 'orca', 'orca-ide', 'orca-dev'])(
    'preserves the configured command %s for mixed runtimes',
    (command) => {
      vi.stubEnv('ORCA_CLI_COMMAND', command)
      expect(resolveCompatibilityCliCommand()).toBe(command)
    }
  )

  it('uses the dev command for an explicit dev invocation with a custom profile', () => {
    vi.stubEnv('ORCA_CLI_COMMAND', undefined)
    vi.stubEnv('ORCA_DEV_CLI_INVOCATION', '1')
    vi.stubEnv('ORCA_USER_DATA_PATH', '/custom/profile')
    expect(resolveCompatibilityCliCommand()).toBe('axiom-dev')
  })

  it('defaults to the public Axiom CLI', () => {
    vi.stubEnv('ORCA_CLI_COMMAND', undefined)
    vi.stubEnv('ORCA_DEV_CLI_INVOCATION', undefined)
    vi.stubEnv('ORCA_USER_DATA_PATH', undefined)
    expect(resolveCompatibilityCliCommand()).toBe('axiom')
  })

  it.each(['axiom', 'axiom-dev', 'orca', 'orca-ide'])(
    'preserves the packaged Windows resume command %s',
    (command) => {
      vi.stubEnv('ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER', '1')
      vi.stubEnv('ORCA_CLI_COMMAND', command)
      expect(resolvePackagedWindowsCompatibilityCommand()).toBe(command)
    }
  )

  it('recognizes the Axiom development data directory', () => {
    vi.stubEnv('ORCA_DEV_CLI_INVOCATION', undefined)
    vi.stubEnv('ORCA_USER_DATA_PATH', '/tmp/axiom-dev')
    expect(isDevCliInvocation()).toBe(true)
  })
})
