import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { withHooklessGit } from './hookless-git'

type FsPromisesModule = typeof fs
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<FsPromisesModule>()
  return { ...actual, rm: vi.fn(actual.rm) }
})

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(fs.rm).mockReset()
  const { rm } = await vi.importActual<FsPromisesModule>('node:fs/promises')
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

it('a directory that cannot be removed does not fail the write', async () => {
  const removalError = new Error('removal failed')
  vi.mocked(fs.rm).mockRejectedValue(removalError)
  const result = { written: true }
  expect(
    await withHooklessGit(
      tmpdir(),
      { timeout: undefined, confine: false },
      async ({ directory }) => {
        directories.push(directory)
        return result
      }
    )
  ).toBe(result)
  const writeError = new Error('write failed')
  await expect(
    withHooklessGit(tmpdir(), { timeout: undefined, confine: false }, async ({ directory }) => {
      directories.push(directory)
      throw writeError
    })
  ).rejects.toBe(writeError)
  expect(fs.rm).toHaveBeenCalledTimes(2)
  for (const directory of directories) {
    expect(fs.rm).toHaveBeenCalledWith(directory, { recursive: true, force: true })
    expect((await fs.stat(directory)).isDirectory()).toBe(true)
  }
})
