import { expect, it } from 'vitest'
import { plannerDeniedInput } from './planner-denied-input'
it('keeps only the command or file path and redacts before truncating', () => {
  expect(
    plannerDeniedInput('Bash', {
      command: "TOKEN='private value' git log",
      env: { KEY: 'secret' },
      description: 'private'
    })
  ).toBe('[REDACTED environment assignment]')
  expect(plannerDeniedInput('Write', { file_path: '/repo/example.ts', content: 'private' })).toBe(
    '/repo/example.ts'
  )
  const summary = plannerDeniedInput('Bash', {
    command: `${'a'.repeat(190)} sk-1234567890abcdefghijklmnop`
  })
  expect(summary.length).toBeLessThanOrEqual(200)
  expect(summary).not.toContain('sk-')
})
it('omits environment maps for other tools and bounds unrecognized input', () => {
  expect(plannerDeniedInput('other', { env: { KEY: 'private' }, action: 'read' })).toBe(
    '{"env":"[REDACTED]","action":"read"}'
  )
  expect(plannerDeniedInput('other', { data: 'a'.repeat(300) })).length(200)
})

it.each([
  ["TOKEN=$'private value' git log", 'ANSI-C quoted'],
  ['TOKEN=private\\ value git log', 'escaped space'],
  ['TOKEN=\'private\'" value" git log', 'concatenated quotes'],
  ['env TOKEN\\=private\\ value git log', 'escaped assignment delimiter'],
  ['TOKEN= git log', 'empty value'],
  ['git log --format=%H', 'conservative ambiguous equals']
])('omits the whole Bash command for %s (%s)', (command) => {
  expect(plannerDeniedInput('Bash', { command })).toBe('[REDACTED environment assignment]')
})
it('retains ordinary Bash evidence without copying the surrounding input', () => {
  expect(plannerDeniedInput('Bash', { command: 'git log -1', env: { TOKEN: 'private' } })).toBe(
    'git log -1'
  )
  expect(
    plannerDeniedInput('Read', { file_path: '/repo/a=b.ts', environment: { TOKEN: 'private' } })
  ).toBe('/repo/a=b.ts')
})
it('redacts nested environment-key variants without copying their values', () => {
  expect(
    plannerDeniedInput('other', {
      nested: {
        ENV: { TOKEN: 'private-one' },
        environment_variables: { TOKEN: 'private-two' },
        'environment-variables': { TOKEN: 'private-three' },
        envVars: { TOKEN: 'private-four' }
      }
    })
  ).toBe(
    '{"nested":{"ENV":"[REDACTED]","environment_variables":"[REDACTED]","environment-variables":"[REDACTED]","envVars":"[REDACTED]"}}'
  )
})
