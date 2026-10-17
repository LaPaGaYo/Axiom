import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from './runtime-client'
import { parseArgs, validateCommandAndFlags } from './args'
import { dispatch } from './dispatch'
import { COMMAND_SPECS } from './specs'
import { cases } from './axiom-command-cases.test-support'
import { goal, makeProposal } from '../shared/axiom-contract/contract-fixtures.test-support'

describe('M1 CLI commands', () => {
  const directories: string[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of directories.splice(0)) {
      rmSync(dir, { recursive: true })
    }
  })

  it.each(cases)(
    'registers and routes $command to $method',
    async ({ command, flags, method, params }) => {
      const cwd = mkdtempSync(join(tmpdir(), 'axiom-cli-'))
      directories.push(cwd)
      writeFileSync(join(cwd, 'goal.json'), JSON.stringify(goal))
      writeFileSync(join(cwd, 'plan.json'), JSON.stringify(makeProposal()))
      const spec = COMMAND_SPECS.find((item) => item.path.join(' ') === command)
      expect(spec?.allowedFlags).toEqual(expect.arrayContaining(['json', ...Object.keys(flags)]))
      expect(spec?.usage).toMatch(/^axiom /)
      expect(spec?.examples?.length).toBeGreaterThan(0)
      const parsed = parseArgs(
        [
          ...command.split(' '),
          ...Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]),
          '--json'
        ],
        COMMAND_SPECS.map((entry) => entry.path),
        COMMAND_SPECS
      )
      validateCommandAndFlags(COMMAND_SPECS, parsed)
      expect(parsed.commandPath).toEqual(command.split(' '))
      expect(parsed.flags.get('json')).toBe(true)
      const client = new RuntimeClient(cwd, 500, null, null)
      const response = { id: 'rpc', ok: true as const, result: {}, _meta: { runtimeId: 'runtime' } }
      const call = vi.spyOn(client, 'call').mockResolvedValue(response)
      const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      await dispatch(command.split(' '), {
        flags: parsed.flags,
        client,
        cwd,
        json: true
      })
      expect(call).toHaveBeenCalledExactlyOnceWith(method, params, {
        orchestrationRequestId: undefined
      })
      expect(JSON.parse(output.mock.calls[0][0])).toEqual(response)
    }
  )
})
