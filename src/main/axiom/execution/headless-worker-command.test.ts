import { describe, expect, it, vi } from 'vitest'
import { buildHeadlessWorkerCommand } from './headless-worker-command'
import { resolveCodexCommand } from '../../codex-cli/command'

vi.mock('../../codex-cli/command', () => ({ resolveCodexCommand: vi.fn(() => '/opt/bin/codex') }))

describe('headless Worker command', () => {
  it.each(['darwin', 'linux'] as const)('uses sandboxed exec on %s', (platform) => {
    const launch = buildHeadlessWorkerCommand({
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
      platform,
      worktree: '/work tree',
      attemptDir: '/host/attempt'
    })!
    expect(resolveCodexCommand).toHaveBeenCalled()
    expect(launch.argv).toEqual([
      '/opt/bin/codex',
      'exec',
      '--json',
      '--color',
      'never',
      '-s',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.network_access=false',
      '-c',
      'approval_policy="never"',
      '-C',
      '/work tree',
      '-o',
      '/host/attempt/last-message.md',
      '-m',
      'gpt-5.5',
      '-c',
      'model_reasoning_effort=high',
      '-'
    ])
    expect(launch.stdinPath).toBe('/host/attempt/prompt.md')
    expect(launch.env).toEqual({})
    expect(launch.argv.join(' ')).not.toMatch(/dangerously-bypass|full-auto/)
  })
  it('honours the executable override and maps effort even for the provider default model', () => {
    const launch = buildHeadlessWorkerCommand({
      provider: 'codex',
      model: 'policy-default',
      effort: 'medium',
      platform: 'linux',
      worktree: '/work',
      attemptDir: '/host/attempt',
      commandOverride: "'/fake provider'"
    })!
    expect(launch.argv[0]).toBe('/fake provider')
    expect(launch.argv).not.toContain('-m')
    expect(launch.argv).toContain('model_reasoning_effort=medium')
  })
  it.each([
    'codex --full-auto',
    'codex --dangerously-bypass-approvals-and-sandbox',
    'codex; other',
    '$(resolve-codex)'
  ])('refuses nonliteral executable overrides: %s', (commandOverride) => {
    expect(() =>
      buildHeadlessWorkerCommand({
        provider: 'codex',
        model: 'policy-default',
        effort: 'medium',
        worktree: '/work',
        attemptDir: '/host/attempt',
        platform: 'linux',
        commandOverride
      })
    ).toThrow(/override/)
  })
  it.each([
    ['codex', 'win32'],
    ['claude', 'darwin']
  ] as const)('keeps %s / %s on the fallback', (provider, platform) => {
    expect(
      buildHeadlessWorkerCommand({
        provider,
        platform,
        model: 'policy-default',
        effort: 'medium',
        worktree: '/work',
        attemptDir: '/host/attempt'
      })
    ).toBeNull()
  })
})
