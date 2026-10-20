import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { ArtifactStore } from '../artifacts/artifact-store'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import type { RecoveryContext, AttemptBinding } from './attempt-recovery-effects'
import { observeAgentExit } from './agent-exit-observation'

describe('agent exit observation', () => {
  let f: ReturnType<typeof channelFixture>
  let ctx: RecoveryContext
  let binding: AttemptBinding
  let observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>

  beforeEach(() => {
    f = channelFixture()
    ctx = {
      ...f,
      artifacts: new ArtifactStore(f.store, join(tmpdir(), 'axiom-agent-exit-unused')),
      now: Date.now
    }
    binding = f.store.getAttemptBinding(f.t01.taskId, 1)!
    observation = {
      status: 'live',
      exact: true,
      terminal: {
        handle: f.t01.from,
        ptyId: 'pty-1',
        worktreeId: 'repo::T01',
        worktreePath: '/fixture/T01',
        branch: binding.branch,
        tabId: 'tab',
        leafId: 'leaf',
        title: 'Codex',
        connected: true,
        writable: true,
        lastOutputAt: null,
        preview: '',
        paneRuntimeId: 1,
        rendererGraphEpoch: 1
      }
    }
    vi.spyOn(f.runtime, 'confirmTerminalShellForeground').mockResolvedValue(true)
  })
  afterEach(() => {
    f.db.close()
    vi.restoreAllMocks()
  })
  const worker = () => f.db.getWorkerDispatch(f.t01.attemptId)!

  it('requires live PTY evidence', async () => {
    observation.status = 'unverifiable'
    await expect(observeAgentExit(ctx, binding, observation, worker())).resolves.toEqual({
      exited: false
    })
    expect(f.runtime.confirmTerminalShellForeground).not.toHaveBeenCalled()
  })
  it('excludes structured workers with no terminal', async () => {
    observation.terminal = null
    await expect(observeAgentExit(ctx, binding, observation, worker())).resolves.toEqual({
      exited: false
    })
    expect(f.runtime.confirmTerminalShellForeground).not.toHaveBeenCalled()
  })
  it('requires exact process identity', async () => {
    observation.exact = false
    await expect(observeAgentExit(ctx, binding, observation, worker())).resolves.toEqual({
      exited: false
    })
    expect(f.runtime.confirmTerminalShellForeground).not.toHaveBeenCalled()
  })
  it.each([
    'starting',
    'start_unknown',
    'stopping',
    'stop_unknown',
    'succeeded',
    'failed',
    'stopped',
    'abandoned'
  ] as const)('excludes a %s worker', async (state) => {
    await expect(
      observeAgentExit(ctx, binding, observation, { ...worker(), state })
    ).resolves.toEqual({
      exited: false
    })
    expect(f.runtime.confirmTerminalShellForeground).not.toHaveBeenCalled()
  })
  it.each([null, undefined])('requires a worker row (%s)', async (missing) => {
    await expect(observeAgentExit(ctx, binding, observation, missing)).resolves.toEqual({
      exited: false
    })
    expect(f.runtime.confirmTerminalShellForeground).not.toHaveBeenCalled()
  })
  it('requires the controller to prove shell foreground', async () => {
    vi.mocked(f.runtime.confirmTerminalShellForeground).mockResolvedValue(false)
    await expect(observeAgentExit(ctx, binding, observation, worker())).resolves.toEqual({
      exited: false
    })
    expect(f.runtime.confirmTerminalShellForeground).toHaveBeenCalledExactlyOnceWith(f.t01.from)
  })
  it('uses one fresh proof for each qualifying observation', async () => {
    await expect(observeAgentExit(ctx, binding, observation, worker())).resolves.toEqual({
      exited: true,
      evidence: 'shell_foreground'
    })
    expect(f.runtime.confirmTerminalShellForeground).toHaveBeenCalledExactlyOnceWith(f.t01.from)
    vi.mocked(f.runtime.confirmTerminalShellForeground).mockResolvedValue(false)
    await expect(observeAgentExit(ctx, binding, observation, worker())).resolves.toEqual({
      exited: false
    })
    expect(f.runtime.confirmTerminalShellForeground).toHaveBeenCalledTimes(2)
  })
})
