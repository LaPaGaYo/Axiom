import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { readCandidateDiff } from './candidate-diff'
import { evaluateDiffGate } from './diff-gate'

let cwd: string
const file = 'src/sample.test.ts'
const git = async (...args: string[]) =>
  (await gitExecFileAsync(args, gitOptionsForWorktree(cwd))).stdout.trim()
const put = async (name: string, content: string) => {
  await mkdir(path.dirname(path.join(cwd, name)), { recursive: true })
  await writeFile(path.join(cwd, name), content)
}
const commit = async () => {
  await git('add', '-A')
  await git('commit', '--no-gpg-sign', '-qm', 'sample')
}
beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'axiom-tampering-'))
  await git('init', '-q')
  await git('config', 'user.name', 'Tamper test')
  await git('config', 'user.email', 'tamper@localhost')
  await git('config', 'core.hooksPath', '')
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})
async function baseline(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await put(name, content)
  }
  await commit()
  await git('branch', 'axiom/integration/tamper')
}
async function findings(allowedPaths = ['.'], rules = {}) {
  await commit()
  const diff = await readCandidateDiff({
    cwd,
    missionId: 'tamper',
    candidateCommitSha: await git('rev-parse', 'HEAD')
  })
  expect(diff).toMatchObject({ ok: true, patchComplete: true })
  return evaluateDiffGate({
    diff,
    allowedPaths,
    rules: VerificationRulesSchema.parse(rules)
  }).tampering
}

it.each([
  { destination: null, content: '', allowed: ['src/'], deleted: true },
  { destination: 'src/moved.spec.ts', content: 'expect(1)\n', allowed: ['src/'], deleted: false },
  { destination: 'src/moved.spec.ts', content: 'expect(2)\n', allowed: ['src/'], deleted: true },
  { destination: 'src/moved.ts', content: 'expect(1)\n', allowed: ['src/'], deleted: true },
  { destination: null, content: '', allowed: ['./src//sample.test.ts/'], deleted: false },
  { destination: null, content: '', allowed: ['src\\sample.test.ts'], deleted: false },
  { destination: null, content: '', allowed: ['**/*.test.ts'], deleted: true },
  { destination: null, content: '', allowed: ['src/../src/sample.test.ts'], deleted: true }
])('deletion exemption %#', async ({ destination, content, allowed, deleted }) => {
  await baseline({ [file]: 'expect(1)\n' })
  await rm(path.join(cwd, file))
  if (destination) {
    await put(destination, content)
  }
  expect(await findings(allowed)).toEqual(
    deleted ? [{ path: file, rule: 'test_file_deleted', count: 1 }] : []
  )
})

const skipFamilies = [
  'describe.skip("x"); it.only("x"); test.todo("x"); suite.skipIf(true); context.runIf(false); bench.fails("x");',
  'xit("x"); xtest("x"); xdescribe("x"); xcontext("x"); xsuite("x"); fit("x"); fdescribe("x"); ftest("x");',
  '@pytest.mark.skip\n@pytest.mark.skipif\n@pytest.mark.xfail',
  'pytest.skip("pending")',
  '@unittest.skip("pending")',
  't.Skip("pending"); t.Skipf("pending"); t.SkipNow()'
]
it.each(skipFamilies.map((content, i) => ({ content, count: [6, 8, 3, 1, 1, 3][i] })))(
  'counts skip family $content',
  async ({ content, count }) => {
    await baseline({ [file]: 'unchanged\n' })
    await put(file, `unchanged\n${content}\n`)
    expect(await findings()).toEqual([{ path: file, rule: 'test_skip_added', count }])
  }
)
it('nets a moved skip line per file, without leaking matched text', async () => {
  await baseline({ [file]: 'test.skip("old")\nanchor1\nanchor2\nanchor3\n' })
  await put(file, 'anchor1\nanchor2\nanchor3\ntest.skip("old")\ntest.only("PRIVATE_MATCH")\n')
  const result = await findings()
  expect(result).toEqual([{ path: file, rule: 'test_skip_added', count: 1 }])
  expect(JSON.stringify(result)).not.toContain('PRIVATE_MATCH')
})
it('a reordered and reformatted skip marker is neutral', async () => {
  await baseline({ [file]: 'xit("x")\na\nb\nc\n' })
  await put(file, 'a\nb\nc\n  xit  ("x")\n')
  expect(await findings()).toEqual([])
})

const assertions = [
  'expect(x); assert(x); assert.strict.equal(x, y); expect.soft(x);',
  'assertEqual(x, y); assertTrue(x);',
  '  assert x\nassert y',
  'x.should.equal(y); y.should.be.true;',
  't.Error(x); t.Errorf(x); t.Fatal(x); t.Fatalf(x); t.Fail(); t.FailNow();'
]
it.each(assertions.map((content, i) => ({ content, count: [4, 2, 2, 2, 6][i] })))(
  'counts assertion family $content',
  async ({ content, count }) => {
    await baseline({ [file]: `${content}\n` })
    await put(file, '// removed calls\n')
    expect(await findings()).toEqual([{ path: file, rule: 'assertions_reduced', count }])
  }
)
it.each(['increase', 'reorder'])('allows an assertion %s', async (mode) => {
  await baseline({ [file]: 'expect(a)\nassert(b)\nanchor\n' })
  await put(
    file,
    mode === 'increase'
      ? 'expect(a)\nassert(b)\nexpect(c)\nanchor\n'
      : 'assert(b)\nanchor\nexpect(a)\n'
  )
  expect(await findings()).toEqual([])
})

const suppressions = [
  'eslint-disable',
  'oxlint-disable',
  'biome-ignore',
  '@ts-ignore',
  '@ts-nocheck',
  '@ts-expect-error',
  '# noqa',
  '# type: ignore',
  'pylint: disable',
  'nolint',
  'istanbul ignore',
  'c8 ignore',
  'v8 ignore'
]
it.each(suppressions)('counts %s in production and test files', async (marker) => {
  await baseline({ [file]: 'before\n', 'src/production.ts': 'before\n' })
  await put(file, `before\n${marker}\n`)
  await put('src/production.ts', `before\n${marker}\n`)
  expect(await findings()).toEqual([
    { path: 'src/production.ts', rule: 'suppression_added', count: 1 },
    { path: file, rule: 'suppression_added', count: 1 }
  ])
})
it('nets suppressions and ignores skip and assertion counts outside test patterns', async () => {
  await baseline({ 'src/production.ts': 'expect(1)\n// c8 ignore next\nanchor\n' })
  await put('src/production.ts', 'anchor\ntest.skip("x")\n// c8 ignore next\n')
  expect(await findings()).toEqual([])
})
it('sorts by path then rule, preserving net counts independently of change order', async () => {
  await baseline({ [file]: 'expect(1)\nexpect(2)\n', 'a.test.ts': 'expect(1)\n' })
  await put(file, 'test.skip("x")\n// c8 ignore next\n')
  await put('a.test.ts', 'test.only("x")\n')
  expect(await findings()).toEqual([
    { path: 'a.test.ts', rule: 'assertions_reduced', count: 1 },
    { path: 'a.test.ts', rule: 'test_skip_added', count: 1 },
    { path: file, rule: 'assertions_reduced', count: 2 },
    { path: file, rule: 'suppression_added', count: 1 },
    { path: file, rule: 'test_skip_added', count: 1 }
  ])
})
it('replaces the test patterns instead of appending to defaults', async () => {
  await baseline({ [file]: 'before\n', 'checks/custom.ts': 'before\n' })
  await put(file, 'test.skip("default")\n')
  await put('checks/custom.ts', 'test.skip("custom")\n')
  expect(await findings(['.'], { testPathPatterns: ['checks/**'] })).toEqual([
    { path: 'checks/custom.ts', rule: 'test_skip_added', count: 1 }
  ])
})

it('does not flag the frozen S4 attempt-2.patch applied to fixture-like content', async () => {
  // D42 fixture-v1, scenarios/retry/attempt-2.patch: change the input tables, keep assertions.
  const before = [
    "import { expect, test } from 'vitest'",
    "import { dateRange } from './date-range.js'",
    '',
    "test.each([{}, { from: '2024-02-29' }, { to: '2024-02-29', entityId: '' },",
    "  { from: '9999-12-31', to: '9999-12-31', entityId: 't1' }])('dateRange accepts inclusive and optional boundaries: %j', input => {",
    '  expect(dateRange(input)).toEqual({ ok: true, value: input })',
    '})',
    '',
    "test.each([null, [], '', { unknown: '' }, { from: '' }, { to: null }, { from: '2023-02-29' },",
    "  { to: '10000-01-01' }, { entityId: 1 }, { from: '2024-01-02', to: '2024-01-01' }])('dateRange rejects invalid input: %j', input => {",
    "  expect(dateRange(input)).toMatchObject({ ok: false, error: { code: 'validation' } })",
    '})',
    ''
  ].join('\n')
  const patch = [
    'diff --git a/src/services/date-range.test.ts b/src/services/date-range.test.ts',
    '--- a/src/services/date-range.test.ts',
    '+++ b/src/services/date-range.test.ts',
    '@@ -1,12 +1,12 @@',
    ...before
      .trimEnd()
      .split('\n')
      .flatMap((line, i) => {
        const replacement =
          i === 3
            ? line.replace("entityId: ''", "entityId: 't1'")
            : i === 9
              ? line.replace('{ entityId: 1 },', "{ entityId: 1 }, { entityId: '' },")
              : line
        return replacement === line ? [` ${line}`] : [`-${line}`, `+${replacement}`]
      }),
    ''
  ].join('\n')
  await baseline({ 'src/services/date-range.test.ts': before })
  const patchPath = path.join(cwd, '.git', 's4.patch')
  await writeFile(patchPath, patch)
  await git('apply', patchPath)
  expect(await findings()).toEqual([])
})
