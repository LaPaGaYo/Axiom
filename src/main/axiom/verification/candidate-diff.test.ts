import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as runner from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { readCandidateDiff } from './candidate-diff'
import { evaluateDiffGate } from './diff-gate'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'

let cwd: string
let base: string
const branch = 'axiom/integration/mission-diff'
const git = async (...args: string[]) =>
  (await runner.gitExecFileAsync(args, gitOptionsForWorktree(cwd))).stdout.trim()
const put = async (file: string, content: string | Buffer) => {
  await mkdir(path.dirname(path.join(cwd, file)), { recursive: true })
  await writeFile(path.join(cwd, file), content)
}
const commit = async () => {
  await git('add', '-A')
  await git('-c', 'core.hooksPath=', 'commit', '--no-gpg-sign', '-qm', 'fixture')
  return git('rev-parse', 'HEAD')
}
const read = async (patchByteLimit?: number) =>
  readCandidateDiff({
    cwd,
    missionId: 'mission-diff',
    candidateCommitSha: await git('rev-parse', 'HEAD'),
    patchByteLimit
  })
beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'axiom-diff-'))
  await git('init', '-q')
  await git('config', 'user.name', 'Diff test')
  await git('config', 'user.email', 'diff@localhost')
  await git('config', 'core.hooksPath', '')
  await put('gone.txt', 'gone\n')
  await put('keep.txt', 'before\n')
  await put('mode.txt', 'mode\n')
  await put('old.txt', 'renamed\n')
  base = await commit()
  await git('branch', branch)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})

it('pairs NUL paths with patch sections, including binary, empty, deleted, mode and rename changes', async () => {
  await put('bin.dat', Buffer.from([0, 1, 2]))
  await put('empty.txt', '')
  await rm(path.join(cwd, 'gone.txt'))
  await put('keep.txt', '++ tricky\ndiff --git a/fake b/fake\n')
  await rename(path.join(cwd, 'old.txt'), path.join(cwd, 'new.txt'))
  const quoted = process.platform === 'win32' ? 'space \u00e9.txt' : 'space "quote".txt'
  await put(quoted, 'quoted\n')
  await git('add', '-A')
  await git('update-index', '--chmod=+x', 'mode.txt')
  await git('commit', '--no-gpg-sign', '-qm', 'changes')
  const sha = await git('rev-parse', 'HEAD')
  const diff = await read()
  expect(diff).toMatchObject({
    ok: true,
    integrationBase: { branch, sha: base },
    mergeBase: base,
    candidateCommitSha: sha,
    patchComplete: true
  })
  if (!diff.ok) {
    throw new Error('Expected diff')
  }
  expect(diff.changes).toEqual([
    { status: 'A', path: 'bin.dat' },
    { status: 'A', path: 'empty.txt' },
    { status: 'D', path: 'gone.txt' },
    { status: 'M', path: 'keep.txt' },
    { status: 'M', path: 'mode.txt' },
    { status: 'A', path: 'new.txt' },
    { status: 'D', path: 'old.txt' },
    { status: 'A', path: quoted }
  ])
  expect(diff.binary).toEqual(['bin.dat'])
  expect([...diff.addedText]).toEqual([
    ['keep.txt', '++ tricky\ndiff --git a/fake b/fake'],
    ['new.txt', 'renamed'],
    [quoted, 'quoted']
  ])
  expect([...diff.removedText]).toEqual([
    ['gone.txt', 'gone'],
    ['keep.txt', 'before'],
    ['old.txt', 'renamed']
  ])
  await git('config', 'diff.external', 'axiom_missing_external_diff')
  await git('config', 'color.ui', 'always')
  await git('config', 'diff.submodule', 'log')
  await git('config', 'diff.noprefix', 'true')
  await git('config', 'diff.renames', 'true')
  await git('config', 'diff.hostile.textconv', 'axiom_missing_textconv')
  await put('.git/info/attributes', '*.txt diff=hostile\n')
  expect(await read()).toEqual(diff)
})

it('reports missing integration refs without throwing raw Git output', async () => {
  await git('branch', '-D', branch)
  expect(await read()).toMatchObject({ ok: false, reason: 'integration_base_unavailable' })
})

it.skipIf(process.platform === 'win32')(
  'pairs both patch sections for a file replaced by a symlink',
  async () => {
    await rm(path.join(cwd, 'keep.txt'))
    await symlink('gone.txt', path.join(cwd, 'keep.txt'))
    await commit()
    expect(await read()).toMatchObject({
      ok: true,
      changes: [{ status: 'T', path: 'keep.txt' }],
      addedText: new Map([['keep.txt', 'gone.txt']]),
      removedText: new Map([['keep.txt', 'before']]),
      binary: [],
      patchComplete: true
    })
  }
)

it.skipIf(process.platform === 'win32')(
  'keeps ordinary changes aligned between type changes',
  async () => {
    for (const file of ['keep.txt', 'old.txt']) {
      await rm(path.join(cwd, file))
      await symlink('gone.txt', path.join(cwd, file))
    }
    await put('mode.txt', '++ between type changes\n')
    await commit()
    expect(await read()).toMatchObject({
      ok: true,
      changes: [
        { status: 'T', path: 'keep.txt' },
        { status: 'M', path: 'mode.txt' },
        { status: 'T', path: 'old.txt' }
      ],
      addedText: new Map([
        ['keep.txt', 'gone.txt'],
        ['mode.txt', '++ between type changes'],
        ['old.txt', 'gone.txt']
      ]),
      removedText: new Map([
        ['keep.txt', 'before'],
        ['mode.txt', 'mode'],
        ['old.txt', 'renamed']
      ]),
      patchComplete: true
    })
  }
)

it.each(['addition', 'pointer change'])(
  'includes a gitlink %s despite diff.ignoreSubmodules=all',
  async (kind) => {
    if (kind === 'pointer change') {
      await git('update-index', '--add', '--cacheinfo', `160000,${base},vendor/sub`)
      await git('commit', '--no-gpg-sign', '-qm', 'initial submodule')
      await git('update-ref', `refs/heads/${branch}`, await git('rev-parse', 'HEAD'))
    }
    await git('config', 'diff.ignoreSubmodules', 'all')
    const target = await git('rev-parse', 'HEAD')
    await git('update-index', '--add', '--cacheinfo', `160000,${target},vendor/sub`)
    await git('commit', '--no-gpg-sign', '-qm', 'submodule candidate')
    const diff = await read()
    expect(diff).toMatchObject({
      ok: true,
      changes: [{ status: kind === 'addition' ? 'A' : 'M', path: 'vendor/sub' }],
      addedText: new Map([['vendor/sub', `Subproject commit ${target}`]]),
      patchComplete: true
    })
    expect(
      evaluateDiffGate({
        diff,
        allowedPaths: ['keep.txt'],
        rules: VerificationRulesSchema.parse({})
      })
    ).toMatchObject({
      outcome: 'fail',
      reason: 'scope_violation',
      scopeViolations: ['vendor/sub']
    })
  }
)

it('reports unrelated histories and preserves the resolved integration identity', async () => {
  const tree = await git('rev-parse', 'HEAD^{tree}')
  const unrelated = await git('commit-tree', tree, '-m', 'unrelated')
  await git('update-ref', `refs/heads/${branch}`, unrelated)
  expect(await read()).toMatchObject({
    ok: false,
    reason: 'merge_base_unavailable',
    integrationBase: { branch, sha: unrelated }
  })
})

it('excludes another Task after a fix merges the newer integration base', async () => {
  await git('checkout', '-qb', 'candidate')
  await put('mine.txt', 'mine\n')
  await commit()
  await git('checkout', branch)
  await put('other-task.txt', 'other\n')
  const advanced = await commit()
  await git('checkout', 'candidate')
  await git('merge', '--no-gpg-sign', '--no-ff', '-m', 'fix base', branch)
  const diff = await read()
  expect(diff).toMatchObject({
    ok: true,
    mergeBase: advanced,
    integrationBase: { sha: advanced },
    changes: [{ status: 'A', path: 'mine.txt' }]
  })
})

it('drops both text maps when the streamed patch exceeds the byte limit', async () => {
  await put('keep.txt', 'changed\n')
  await commit()
  expect(await read(1)).toMatchObject({
    ok: true,
    patchComplete: false,
    changes: [{ status: 'M', path: 'keep.txt' }],
    addedText: new Map(),
    removedText: new Map(),
    binary: []
  })
})

it('fails closed for malformed name-status and mismatched section counts', async () => {
  const original = runner.gitExecFileAsync
  const spy = vi.spyOn(runner, 'gitExecFileAsync').mockImplementation(async (args, options) => {
    if (args.includes('--name-status')) {
      return { stdout: 'A\0one\0odd\0', stderr: '' }
    }
    return original(args, options)
  })
  expect(await read()).toMatchObject({ ok: false, reason: 'diff_unavailable', mergeBase: base })
  spy.mockRestore()
  await put('keep.txt', 'changed\n')
  await commit()
  vi.spyOn(runner, 'gitStreamStdout').mockResolvedValue({ stoppedEarly: false })
  expect(await read()).toMatchObject({ ok: false, reason: 'diff_unavailable' })
})

it('sanitizes other Git failures', async () => {
  vi.spyOn(runner, 'gitStreamStdout').mockRejectedValue(new Error('raw output must not escape'))
  const result = await read()
  expect(result).toMatchObject({ ok: false, reason: 'diff_unavailable' })
  expect(JSON.stringify(result)).not.toContain('raw output')
})
