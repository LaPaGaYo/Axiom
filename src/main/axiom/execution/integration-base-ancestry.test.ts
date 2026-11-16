import { afterEach, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { ensureIntegrationBase } from './integration-base'

vi.mock('../../git/runner', () => ({ gitExecFileAsync: vi.fn() }))
afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})
const git = vi.mocked(gitExecFileAsync)
const input = { repoPath: '/fixture', targetBranch: 'main', missionId: 'm1' }

it('refuses to reuse an integration base that is not an ancestor of the target branch', async () => {
  for (const code of [1, 128]) {
    git
      .mockReset()
      .mockResolvedValueOnce({ stdout: 'abc\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'def\n', stderr: '' })
      .mockRejectedValueOnce({ code })
    await expect(ensureIntegrationBase(input)).rejects.toMatchObject({
      code: 'integration_base_unavailable',
      message:
        code === 1
          ? expect.stringContaining('not an ancestor')
          : 'Cannot read the integration base.'
    })
    expect(git.mock.calls.map((call) => call[0])).toEqual([
      ['rev-parse', '--verify', '--quiet', 'refs/heads/axiom/integration/m1'],
      ['rev-parse', '--verify', 'refs/heads/main'],
      ['merge-base', '--is-ancestor', 'abc', 'refs/heads/main']
    ])
    expect(git.mock.calls.some((call) => call[0][0] === 'branch')).toBe(false)
  }
  git
    .mockReset()
    .mockResolvedValueOnce({ stdout: 'abc\n', stderr: '' })
    .mockRejectedValueOnce({ code: 128 })
  await expect(ensureIntegrationBase(input)).rejects.toMatchObject({
    code: 'target_branch_not_found'
  })
  expect(git.mock.calls.map((call) => call[0])).toEqual([
    ['rev-parse', '--verify', '--quiet', 'refs/heads/axiom/integration/m1'],
    ['rev-parse', '--verify', 'refs/heads/main']
  ])
})
