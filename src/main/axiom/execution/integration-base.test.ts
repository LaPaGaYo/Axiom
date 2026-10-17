import { afterEach, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { ensureIntegrationBase } from './integration-base'
vi.mock('../../git/runner', () => ({ gitExecFileAsync: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const input = { repoPath: '/fixture', targetBranch: 'main', missionId: 'm1' }
const git = vi.mocked(gitExecFileAsync)
it('creates once at the target HEAD and reuses without moving the ref', async () => {
  git
    .mockRejectedValueOnce({ code: 1 })
    .mockResolvedValueOnce({ stdout: 'abc\n', stderr: '' })
    .mockResolvedValueOnce({ stdout: '', stderr: '' })
  expect(await ensureIntegrationBase(input)).toEqual({ sha: 'abc', created: true })
  expect(git.mock.calls.map((c) => c[0])).toEqual([
    ['rev-parse', '--verify', '--quiet', 'refs/heads/axiom/integration/m1'],
    ['rev-parse', '--verify', 'refs/heads/main'],
    ['branch', 'axiom/integration/m1', 'abc']
  ])
  expect(git.mock.calls.every((c) => c[1]?.cwd === '/fixture')).toBe(true)
  git.mockClear().mockResolvedValueOnce({ stdout: 'abc\n', stderr: '' })
  expect(await ensureIntegrationBase(input)).toEqual({ sha: 'abc', created: false })
  expect(git).toHaveBeenCalledTimes(1)
})
it('distinguishes a missing target from an unavailable integration ref', async () => {
  git.mockRejectedValueOnce({ code: 1 }).mockRejectedValueOnce(new Error('missing'))
  await expect(ensureIntegrationBase(input)).rejects.toMatchObject({
    code: 'target_branch_not_found'
  })
  git
    .mockRejectedValueOnce({ code: 1 })
    .mockResolvedValueOnce({ stdout: 'abc', stderr: '' })
    .mockRejectedValueOnce(new Error('locked'))
  await expect(ensureIntegrationBase(input)).rejects.toMatchObject({
    code: 'integration_base_unavailable'
  })
})
