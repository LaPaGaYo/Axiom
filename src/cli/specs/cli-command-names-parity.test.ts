import { AXIOM_CLI_COMMAND_NAMES } from '../../shared/axiom-contract/namespace'
import { describe, expect, it } from 'vitest'
import { CLI_COMMAND_NAMES } from '../../main/startup/cli-command-names'
import { COMMAND_SPECS } from './index'

describe('CLI launch redirect command names', () => {
  it('lists every CLI command, so a direct binary launch never boots the desktop app', () => {
    const roots = new Set(COMMAND_SPECS.map((spec) => spec.path[0]))
    expect([...roots].filter((root) => !CLI_COMMAND_NAMES.some((name) => name === root))).toEqual(
      []
    )
  })
  it.each([
    ['COMMAND_SPECS', [...new Set(COMMAND_SPECS.map((spec) => spec.path[0]))]],
    ['CLI_COMMAND_NAMES', CLI_COMMAND_NAMES]
  ])('keeps unimplemented Axiom CLI command names out of %s', (_source, names) => {
    const reserved = new Set<string>(
      AXIOM_CLI_COMMAND_NAMES.filter(
        (name) => !['mission', 'plan', 'task', 'attempt', 'verification'].includes(name)
      )
    )
    expect(names.filter((name) => reserved.has(name))).toEqual([])
  })
})
