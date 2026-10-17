import { describe, expect, it } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'

describe('Axiom attempt CLI registration', () => {
  it.each([
    { verb: 'show', flags: ['--attempt', 'dispatch_123'] },
    { verb: 'list', flags: ['--mission', 'mission_123'] },
    { verb: 'list', flags: ['--mission', 'mission_123', '--task', 'task_123'] }
  ])('accepts attempt $verb through the public command catalog ($flags)', ({ verb, flags }) => {
    const parsed = parseArgs(
      ['attempt', verb, ...flags, '--json'],
      COMMAND_SPECS.map((spec) => spec.path),
      COMMAND_SPECS
    )
    expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
    expect(parsed.commandPath).toEqual(['attempt', verb])
    expect(parsed.flags.get('json')).toBe(true)
  })
})
