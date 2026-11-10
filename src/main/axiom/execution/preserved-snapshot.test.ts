import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { preserveAttemptWorktree } from './preserved-snapshot'
import { preservedRepository } from './preserved-snapshot.test-support'

let f: Awaited<ReturnType<typeof preservedRepository>>
beforeEach(async () => {
  f = await preservedRepository()
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
})

it('preserves the worktree of an Attempt that ended without a Submission', async () => {
  await writeFile(path.join(f.root, 'code.txt'), 'unfinished\nsecond line\n')
  const result = await preserveAttemptWorktree(f.input)
  expect(result).toMatchObject({
    status: 'preserved',
    scopePaths: ['code.txt'],
    secrets: [],
    changes: [{ path: 'code.txt', status: 'modified', added: 2, removed: 1 }]
  })
  if (result.status !== 'preserved') {
    throw new Error('snapshot missing')
  }
  expect(await f.git(['rev-parse', result.snapshot.ref])).toBe(result.snapshot.commitSha)
  expect(await f.git(['show', `${result.snapshot.commitSha}:code.txt`])).toBe(
    'unfinished\nsecond line'
  )
  expect(await f.git(['show', '-s', '--format=%B', result.snapshot.commitSha])).toBe(
    'axiom: preserved snapshot d1'
  )
})

it('leaves the Attempt branch and the worktree index untouched', async () => {
  await writeFile(path.join(f.root, 'code.txt'), 'staged\n')
  await f.git(['add', 'code.txt'])
  await writeFile(path.join(f.root, 'code.txt'), 'unstaged\n')
  const index = await readFile(path.join(f.root, '.git', 'index'))
  await writeFile(path.join(f.root, '.git', 'index.lock'), 'owned by Worker')
  await writeFile(
    path.join(f.root, '.git', 'hooks', 'reference-transaction'),
    '#!/bin/sh\nexit 88\n',
    { mode: 0o755 }
  )
  expect((await preserveAttemptWorktree(f.input)).status).toBe('preserved')
  expect(await f.git(['rev-parse', 'HEAD'])).toBe(f.baselineSha)
  expect(await f.git(['rev-parse', f.branch])).toBe(f.baselineSha)
  expect(await readFile(path.join(f.root, '.git', 'index'))).toEqual(index)
  expect(await readFile(path.join(f.root, '.git', 'index.lock'), 'utf8')).toBe('owned by Worker')
  expect(await readFile(path.join(f.root, 'code.txt'), 'utf8')).toBe('unstaged\n')
})

it('excludes .axiom files and retains commits made by the Worker as ancestors', async () => {
  await writeFile(path.join(f.root, 'code.txt'), 'committed work\n')
  await f.commit('worker progress')
  const workerHead = await f.git(['rev-parse', 'HEAD'])
  await mkdir(path.join(f.root, '.axiom'))
  await writeFile(path.join(f.root, '.axiom', 'prompt.md'), 'prompt')
  await f.git(['add', '.axiom'])
  const result = await preserveAttemptWorktree(f.input)
  if (result.status !== 'preserved') {
    throw new Error('snapshot missing')
  }
  expect(await f.git(['ls-tree', '-r', '--name-only', result.snapshot.commitSha])).toBe('code.txt')
  expect(await f.git(['rev-parse', `${result.snapshot.commitSha}^`])).toBe(workerHead)
  expect(await f.git(['merge-base', workerHead, result.snapshot.commitSha])).toBe(workerHead)
})

it('reuses a published snapshot without writing another object or changing its evidence', async () => {
  await writeFile(path.join(f.root, 'code.txt'), 'first\n')
  const first = await preserveAttemptWorktree(f.input)
  const objects = await f.git(['count-objects', '-v'])
  await writeFile(path.join(f.root, 'code.txt'), 'later\n')
  expect(await preserveAttemptWorktree(f.input)).toEqual(first)
  expect(await f.git(['count-objects', '-v'])).toBe(objects)
})

it('records a ref conflict without changing the existing ref', async () => {
  const ref = 'refs/axiom/preserved/t/1'
  await f.git(['update-ref', ref, f.baselineSha, '0'.repeat(40)])
  await writeFile(path.join(f.root, 'code.txt'), 'partial\n')
  expect(await preserveAttemptWorktree(f.input)).toEqual({
    status: 'unavailable',
    reason: 'ref_conflict',
    snapshot: { ref, commitSha: f.baselineSha }
  })
  expect(await f.git(['rev-parse', ref])).toBe(f.baselineSha)
})

it('decides empty against the launch baseline tree and creates no commit or ref', async () => {
  await writeFile(path.join(f.root, 'code.txt'), 'committed change\n')
  await f.commit('worker progress')
  await writeFile(path.join(f.root, 'code.txt'), 'baseline\n')
  const objects = await f.git(['count-objects', '-v'])
  expect(await preserveAttemptWorktree(f.input)).toEqual({ status: 'empty' })
  expect(await f.git(['for-each-ref', '--format=%(refname)', 'refs/axiom/preserved'])).toBe('')
  expect(await f.git(['count-objects', '-v'])).toBe(objects)
})

it('preserves but refuses more than 200 changed paths', async () => {
  for (let i = 0; i < 201; i++) {
    await writeFile(path.join(f.root, `file-${i}.txt`), 'partial\n')
  }
  const result = await preserveAttemptWorktree(f.input)
  expect(result).toMatchObject({
    status: 'unavailable',
    reason: 'too_many_paths',
    snapshot: { ref: 'refs/axiom/preserved/t/1' }
  })
  expect(await f.git(['rev-parse', '--verify', 'refs/axiom/preserved/t/1'])).toMatch(
    /^[a-f0-9]{40}$/
  )
})

it.each(['missing', 'wrong branch'])('records an unavailable worktree for %s', async (kind) => {
  const launch =
    kind === 'missing'
      ? { ...f.input.launch, worktreePath: path.join(f.root, 'absent') }
      : { ...f.input.launch, branch: 'axiom/attempt/other/1' }
  expect(await preserveAttemptWorktree({ ...f.input, launch })).toEqual({
    status: 'unavailable',
    reason: kind === 'missing' ? 'worktree_missing' : 'branch_mismatch'
  })
})

it('uses verification scope and secret findings without leaking matched text', async () => {
  const secret = `ghp_${'s'.repeat(28)}`
  await writeFile(path.join(f.root, 'outside.txt'), secret)
  const result = await preserveAttemptWorktree({ ...f.input, allowedPaths: ['code.txt'] })
  expect(result).toMatchObject({
    status: 'preserved',
    scopePaths: ['outside.txt'],
    secrets: [{ path: 'outside.txt', pattern: 'provider_token' }]
  })
  expect(JSON.stringify(result)).not.toContain(secret)
})

it('never uses a redacted filename as scope authority', async () => {
  const secret = `ghp_${'x'.repeat(28)}`
  await mkdir(path.join(f.root, 'src'))
  await writeFile(path.join(f.root, 'src', `${secret}.ts`), 'ordinary content\n')
  const result = await preserveAttemptWorktree({ ...f.input, allowedPaths: ['src/??????????.ts'] })
  expect(result).toMatchObject({
    status: 'unavailable',
    reason: 'diff_unavailable',
    snapshot: { ref: 'refs/axiom/preserved/t/1' }
  })
  expect(JSON.stringify(result)).not.toContain(secret)
})
