import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import childProcess from 'node:child_process'
import { verificationFixture } from './verification-fixture.test-support'
import {
  VerificationRulesSchema,
  resolveVerificationPlan
} from '../../../shared/axiom-contract/verification-rules'
import { executeVerificationPlan } from './verification-plan-runner'

let root: string
let f: ReturnType<typeof verificationFixture>
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-plan-checks-'))
  f = verificationFixture(path.join(root, 'artifacts'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
const node = (script: string) => `node -e "${script}"`
async function run(commands: string[], policy: unknown = {}, deadline = Date.now() + 30_000) {
  const rules = VerificationRulesSchema.parse(policy)
  return executeVerificationPlan({
    artifacts: f.artifacts,
    run: f.run,
    cwd: root,
    deadline,
    rules,
    plan: resolveVerificationPlan({ risk: 'low', requiredEvidence: commands }, rules),
    assertCurrent: () => {}
  })
}
it('records command output Artifacts, tool versions, and every failed check in order', async () => {
  const result = await run([
    node("console.error(' FAIL src/a.test.ts > fails'); process.exit(1)"),
    node('console.log(123)'),
    node('process.exit(2)')
  ])
  expect(result.checks.map((c) => c.result)).toEqual(['fail', 'pass', 'fail'])
  expect(result.checks[0].failures).toEqual(['src/a.test.ts > fails'])
  expect(result.checks[0].excerpt).toContain('FAIL')
  expect((await f.artifacts.read(result.checks[0].stderrArtifactId!)).content.toString()).toContain(
    'FAIL src/a.test.ts > fails'
  )
  expect(Object.keys(result.toolVersions)).toEqual(['node', 'pnpm', 'git'])
  expect(result.toolVersions.node).toMatch(/^v\d/)
  expect(result.tools).toHaveLength(3)
  expect(result.tools.every((tool) => tool.stdoutArtifactId && tool.stderrArtifactId)).toBe(true)
})
it('classifies failed setup as environmental and skips every remaining command', async () => {
  const result = await run([node('process.exit(0)')], {
    setupCommands: [node('process.exit(1)'), node('console.log(2)')]
  })
  expect(result.checks).toMatchObject([
    { source: 'setup', result: 'environmental', reason: 'setup_failed' },
    { source: 'setup', result: 'skipped', reason: 'setup_failed' },
    { source: 'evidence', result: 'skipped', reason: 'setup_failed', attempts: [] }
  ])
})
it('spends one deadline, then records checks not started as skipped', async () => {
  const result = await run(
    [node('setInterval(() => {}, 100)'), node('process.exit(1)')],
    {},
    Date.now() + 100
  )
  expect(result.checks).toMatchObject([
    { result: 'environmental', reason: 'timeout' },
    { result: 'skipped', reason: 'time_budget_exhausted' }
  ])
  expect(result.toolVersions).toEqual({
    node: 'unavailable',
    pnpm: 'unavailable',
    git: 'unavailable'
  })
})
it('records both flaky attempts without converting them into PASS', async () => {
  const command = node(
    "const fs=require('node:fs');const f='counter';if(!fs.existsSync(f)){fs.writeFileSync(f,'1');console.error(' FAIL src/a.test.ts > flaky');process.exit(1)}"
  )
  const result = await run([command], { retryOnce: ['node -e'] })
  expect(result.checks[0]).toMatchObject({
    result: 'inconclusive',
    reason: 'flaky',
    failures: ['src/a.test.ts > flaky']
  })
  expect(result.checks[0].attempts.map((a) => a.result)).toEqual(['fail', 'pass'])
  expect(await readFile(path.join(root, 'counter'), 'utf8')).toBe('1')
})
it('retries a repeated failure exactly once and retains both output references', async () => {
  const result = await run(
    [node("console.error(' FAIL src/a.test.ts > persistent');process.exit(1)")],
    { retryOnce: ['node -e'] }
  )
  expect(result.checks[0].result).toBe('fail')
  expect(result.checks[0].attempts.map((attempt) => attempt.result)).toEqual(['fail', 'fail'])
  expect(result.checks[0].attempts.every((attempt) => attempt.stderrArtifactId !== null)).toBe(true)
})
it('caps all check excerpts together at 32 KiB', async () => {
  const result = await run(
    Array.from({ length: 10 }, (_, index) =>
      node(`console.error('Error ${index} ' + 'x'.repeat(5000));process.exit(1)`)
    )
  )
  const excerpts = result.checks.map((check) => check.excerpt)
  expect(excerpts.reduce((total, excerpt) => total + Buffer.byteLength(excerpt), 0)).toBe(32 * 1024)
  expect(
    excerpts.every(
      (excerpt) => Buffer.byteLength(excerpt) <= 4096 && excerpt.split('\n').length <= 40
    )
  ).toBe(true)
  expect(excerpts.at(-1)).toBe('')
})
it('records unavailable version probes without changing passing checks', async () => {
  const spawn = childProcess.spawn
  vi.spyOn(childProcess, 'spawn').mockImplementation((command, options) => {
    if (command === 'pnpm --version') {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }
    return spawn(command, options)
  })
  const result = await run([node('process.exit(0)')])
  expect(result.checks[0].result).toBe('pass')
  expect(result.toolVersions).toMatchObject({
    node: expect.stringMatching(/^v/),
    pnpm: 'unavailable'
  })
})
it('does not retry non-matching commands and quarantines only entirely known failures', async () => {
  const command = node("console.error(' FAIL src/a.test.ts > one');process.exit(1)")
  const result = await run([command], { knownFlaky: ['src/* > one'] })
  expect(result.checks[0]).toMatchObject({ result: 'inconclusive', reason: 'known_flaky' })
  expect(result.checks[0].attempts).toHaveLength(1)
  const mixed = await run(
    [
      node("console.error(' FAIL src/a.test.ts > one\\n FAIL src/a.test.ts > two');process.exit(1)")
    ],
    { knownFlaky: ['src/* > one'] }
  )
  expect(mixed.checks[0].result).toBe('fail')
  const unknown = await run([node('process.exit(1)')], { knownFlaky: ['*'] })
  expect(unknown.checks[0].result).toBe('fail')
})
it('redacts planted credentials before evidence, excerpts and failure names', async () => {
  const secret = `AKIA${'C'.repeat(16)}`
  const result = await run([
    node(`console.error(' FAIL src/a.test.ts > ${secret}');process.exit(1)`)
  ])
  expect(result.checks[0].failures).toEqual(['src/a.test.ts > [REDACTED]'])
  expect(result.checks[0].excerpt).not.toContain(secret)
  expect(
    (await f.artifacts.read(result.checks[0].stderrArtifactId!)).content.toString()
  ).not.toContain(secret)
})
