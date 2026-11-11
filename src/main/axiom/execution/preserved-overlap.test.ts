import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as runner from '../../git/runner'
import { preserveAttemptWorktree } from './preserved-snapshot'
import { preservedRepository } from './preserved-snapshot.test-support'

let f: Awaited<ReturnType<typeof preservedRepository>>
beforeEach(async () => {
  f = await preservedRepository()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(f.root, { recursive: true, force: true })
})

it('adopts the snapshot of an overlapping preservation of the same Attempt', async () => {
  await writeFile(path.join(f.root, 'code.txt'), 'overlapping work\n')
  const run = runner.gitExecFileAsync
  let publishing: (() => void) | undefined
  let release: (() => void) | undefined
  const atPublication = new Promise<void>((resolve) => {
    publishing = resolve
  })
  const holdPublication = new Promise<void>((resolve) => {
    release = resolve
  })
  const git = vi.spyOn(runner, 'gitExecFileAsync').mockImplementation(async (args, options) => {
    if (args.includes('update-ref')) {
      publishing?.()
      await holdPublication
    }
    return run(args, options)
  })
  const earlier = preserveAttemptWorktree(f.input)
  await atPublication
  // The ref is still absent, including the window in which Git can hold its publication lock.
  expect(await f.git(['for-each-ref', '--format=%(refname)', 'refs/axiom/preserved/t/1'])).toBe('')
  const later = preserveAttemptWorktree(f.input)
  expect(later).toBe(earlier)
  release?.()
  const [first, second] = await Promise.all([earlier, later])
  expect(git.mock.calls.filter(([args]) => args.includes('update-ref'))).toHaveLength(1)
  expect(first.status).toBe('preserved')
  expect(second).toEqual(first)
  if (first.status !== 'preserved') {
    throw new Error('Missing snapshot')
  }
  expect(await f.git(['rev-parse', first.snapshot.ref])).toBe(first.snapshot.commitSha)
})

it('keeps a conflicting ref published during capture as a ref conflict', async () => {
  await writeFile(path.join(f.root, 'code.txt'), 'overlapping work\n')
  const run = runner.gitExecFileAsync
  let published = false
  vi.spyOn(runner, 'gitExecFileAsync').mockImplementation(async (args, options) => {
    if (args.includes('update-ref') && !published) {
      published = true
      await run(['update-ref', 'refs/axiom/preserved/t/1', f.baselineSha, '0'.repeat(40)], {
        cwd: f.root
      })
    }
    return run(args, options)
  })
  expect(await preserveAttemptWorktree(f.input)).toEqual({
    status: 'unavailable',
    reason: 'ref_conflict',
    snapshot: { ref: 'refs/axiom/preserved/t/1', commitSha: f.baselineSha }
  })
})
