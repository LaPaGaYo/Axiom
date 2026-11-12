import { expect, it, vi } from 'vitest'
import { buildHeadlessWorkerCommand } from './headless-worker-command'

vi.mock('../../codex-cli/command', () => ({ resolveCodexCommand: () => '/opt/bin/codex' }))

it('builds the Codex resume command with the exec options before resume', () => {
  const input = {
    provider: 'codex',
    model: 'gpt-5.5',
    effort: 'high',
    worktree: '/same worktree',
    attemptDir: '/host/d2',
    accountHomePath: '/account',
    egressEnv: { TEST_PIN: '1' }
  }
  const fresh = buildHeadlessWorkerCommand(input)
  const resumed = buildHeadlessWorkerCommand({ ...input, resumeSessionId: 'thread-1' })
  expect(resumed).toEqual({
    ...fresh,
    argv: [...(fresh?.argv.slice(0, -1) ?? []), 'resume', 'thread-1', '-']
  })
  expect(resumed?.argv.slice(-7)).toEqual([
    '-m',
    'gpt-5.5',
    '-c',
    'model_reasoning_effort=high',
    'resume',
    'thread-1',
    '-'
  ])
})
