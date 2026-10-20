import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access, readdir } from 'node:fs/promises'
import { gitExecFileAsync } from '../../git/runner'
import { snapshotCandidate } from './candidate-snapshot'

vi.mock('../../git/runner', () => ({ gitExecFileAsync: vi.fn() }))
const input = {
  attemptId: 'dispatch-1',
  worktreeId: 'repo::/fixture/attempt',
  branch: 'axiom/attempt/task-1/1'
}
const commitSha = 'a'.repeat(40)
const treeSha = 'b'.repeat(40)
let dirty: boolean
let branch: string
beforeEach(() => {
  dirty = false
  branch = input.branch
  vi.mocked(gitExecFileAsync)
    .mockReset()
    .mockImplementation(async (args) => ({
      stdout:
        args[0] === 'symbolic-ref'
          ? `${branch}\n`
          : args[0] === 'status'
            ? dirty
              ? ' M src/file.ts\n'
              : ''
            : args[0] === 'rev-parse'
              ? `${args[1] === 'HEAD' ? commitSha : treeSha}\n`
              : '',
      stderr: ''
    }))
})

describe('Control Plane candidate snapshot', () => {
  it('adopts clean HEAD without modifying the worktree', async () => {
    expect(await snapshotCandidate(input)).toEqual({ commitSha, treeSha, snapshotCommitted: false })
    expect(vi.mocked(gitExecFileAsync).mock.calls.map(([args]) => args)).toEqual([
      ['symbolic-ref', '--short', 'HEAD'],
      ['status', '--porcelain'],
      ['rev-parse', 'HEAD'],
      ['rev-parse', 'HEAD^{tree}'],
      ['symbolic-ref', '--short', 'HEAD']
    ])
    for (const [, options] of vi.mocked(gitExecFileAsync).mock.calls) {
      expect(options).toMatchObject({ cwd: '/fixture/attempt' })
    }
  })
  it('snapshots dirty work with the Control Plane identity and without Worker hooks', async () => {
    dirty = true
    expect(await snapshotCandidate(input)).toEqual({ commitSha, treeSha, snapshotCommitted: true })
    expect(gitExecFileAsync).toHaveBeenCalledWith(
      ['-c', expect.stringContaining('core.hooksPath='), 'add', '-A'],
      expect.anything()
    )
    expect(gitExecFileAsync).toHaveBeenCalledWith(
      [
        '-c',
        'user.name=Axiom Control Plane',
        '-c',
        'user.email=axiom@localhost',
        '-c',
        expect.stringContaining('core.hooksPath='),
        'commit',
        '--no-verify',
        '-q',
        '-m',
        'axiom: candidate snapshot dispatch-1'
      ],
      expect.anything()
    )
  })
  it('rejects another branch before any write', async () => {
    dirty = true
    branch = 'main'
    await expect(snapshotCandidate(input)).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'candidate_branch_mismatch'
    })
    expect(gitExecFileAsync).toHaveBeenCalledTimes(1)
  })
  it('isolates all snapshot hooks in a disposable empty directory', async () => {
    dirty = true
    const run = vi.mocked(gitExecFileAsync).getMockImplementation()!
    let hooksPath: string | undefined
    vi.mocked(gitExecFileAsync).mockImplementation(async (...args) => {
      if (args[0].includes('commit')) {
        hooksPath = args[0]
          .find((arg) => arg.startsWith('core.hooksPath='))
          ?.slice('core.hooksPath='.length)
        expect(hooksPath).toBeTruthy()
        expect(await readdir(hooksPath!)).toEqual([])
      }
      return run(...args)
    })
    await snapshotCandidate(input)
    expect(gitExecFileAsync).toHaveBeenCalledWith(
      ['-c', `core.hooksPath=${hooksPath}`, 'add', '-A'],
      expect.anything()
    )
    await expect(access(hooksPath!)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects detached HEAD and malformed worktree ids', async () => {
    vi.mocked(gitExecFileAsync).mockRejectedValueOnce(new Error('detached HEAD'))
    await expect(snapshotCandidate(input)).rejects.toMatchObject({ code: 'invalid_argument' })
    vi.mocked(gitExecFileAsync).mockClear()
    await expect(snapshotCandidate({ ...input, worktreeId: 'repo' })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(gitExecFileAsync).not.toHaveBeenCalled()
  })
})
