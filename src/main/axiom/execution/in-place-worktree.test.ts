import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { preservedRepository } from './preserved-snapshot.test-support'
import { withWorktreeSnapshot } from './worktree-snapshot'
import { inspectContinuationWorktree, takeOverContinuationWorktree } from './in-place-worktree'

let repo: Awaited<ReturnType<typeof preservedRepository>>
beforeEach(async () => {
  repo = await preservedRepository()
})
afterEach(async () => {
  await rm(repo.root, { recursive: true, force: true })
})
async function capture() {
  return withWorktreeSnapshot({ worktreePath: repo.root, branch: repo.branch }, async (tree) => {
    const targetCommit = await tree.commit('snapshot')
    await tree.publish('refs/axiom/preserved/t/1', targetCommit, '0'.repeat(40))
    return { targetCommit, parentCommit: tree.parent, treeSha: tree.treeSha }
  })
}
function inspect(target: { targetCommit: string; treeSha: string }, preserved = true) {
  return inspectContinuationWorktree({
    worktree: { id: `repo::${repo.root}`, path: repo.root },
    previousBranch: repo.branch,
    branch: 'axiom/attempt/t/2',
    baselineRef: target.targetCommit,
    baselineSha: repo.baselineSha,
    snapshot: preserved ? { commitSha: target.targetCommit, treeSha: target.treeSha } : undefined
  })
}
it('moves the reused worktree to the new Attempt branch without changing a file', async () => {
  await writeFile(path.join(repo.root, 'code.txt'), 'modified\n')
  await writeFile(path.join(repo.root, 'new.txt'), 'untracked\n')
  await writeFile(path.join(repo.root, 'staged.txt'), 'staged\n')
  await repo.git(['add', 'staged.txt'])
  await mkdir(path.join(repo.root, '.axiom'))
  await writeFile(path.join(repo.root, '.axiom', 'prompt.md'), 'old prompt\n')
  const snapshot = await capture()
  const before = await Promise.all(
    ['code.txt', 'new.txt', 'staged.txt', '.axiom/prompt.md'].map((file) =>
      readFile(path.join(repo.root, file))
    )
  )
  const evidence = await inspect(snapshot)
  expect(evidence).toBeDefined()
  if (!evidence) {
    throw new Error('Missing fixture evidence')
  }
  await takeOverContinuationWorktree(evidence, repo.branch, 'axiom/attempt/t/2')
  expect(
    await Promise.all(
      ['code.txt', 'new.txt', 'staged.txt', '.axiom/prompt.md'].map((file) =>
        readFile(path.join(repo.root, file))
      )
    )
  ).toEqual(before)
  expect(await repo.git(['symbolic-ref', '--short', 'HEAD'])).toBe('axiom/attempt/t/2')
  expect(await repo.git(['rev-parse', 'HEAD'])).toBe(snapshot.targetCommit)
  expect(await repo.git(['write-tree'])).toBe(snapshot.treeSha)
  expect(await repo.git(['rev-parse', repo.branch])).toBe(repo.baselineSha)
  expect(await repo.git(['rev-parse', 'refs/axiom/preserved/t/1'])).toBe(snapshot.targetCommit)
  expect(await repo.git(['status', '--porcelain'])).toBe('?? .axiom/')
  expect(await inspect(snapshot)).toEqual(evidence)
  await takeOverContinuationWorktree(evidence, repo.branch, 'axiom/attempt/t/2')
  expect(await repo.git(['write-tree'])).toBe(snapshot.treeSha)
})
it('checks real HEAD, branch and private-index tree before reusing a worktree', async () => {
  await writeFile(path.join(repo.root, 'code.txt'), 'modified\n')
  const snapshot = await capture()
  const index = await repo.git(['write-tree'])
  expect(await inspect(snapshot)).toBeDefined()
  expect(await repo.git(['write-tree'])).toBe(index)
  await writeFile(path.join(repo.root, 'code.txt'), 'later change\n')
  expect(await inspect(snapshot)).toBeUndefined()
  await writeFile(path.join(repo.root, 'code.txt'), 'modified\n')
  await repo.commit('worker committed after capture')
  expect(await inspect(snapshot)).toBeUndefined()
})
it('accepts an empty tree only while the baseline ref still resolves to the launch commit', async () => {
  const target = {
    targetCommit: repo.baselineSha,
    treeSha: await repo.git(['rev-parse', 'HEAD^{tree}'])
  }
  expect(await inspect(target, false)).toBeDefined()
  await writeFile(path.join(repo.root, 'code.txt'), 'changed\n')
  const changed = await capture()
  expect(await inspect(changed, false)).toBeUndefined()
})
it('fails after a ref write without attempting a new worktree or changing files', async () => {
  await writeFile(path.join(repo.root, 'code.txt'), 'modified\n')
  const snapshot = await capture()
  const evidence = await inspect(snapshot)
  if (!evidence) {
    throw new Error('Missing fixture evidence')
  }
  const index = await repo.git(['rev-parse', '--git-path', 'index.lock'])
  await writeFile(path.resolve(repo.root, index), 'held')
  await expect(
    takeOverContinuationWorktree(evidence, repo.branch, 'axiom/attempt/t/2')
  ).rejects.toThrow()
  expect(await repo.git(['rev-parse', 'axiom/attempt/t/2'])).toBe(snapshot.targetCommit)
  expect(await readFile(path.join(repo.root, 'code.txt'), 'utf8')).toBe('modified\n')
  expect(await repo.git(['rev-parse', repo.branch])).toBe(repo.baselineSha)
})
