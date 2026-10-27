import { expect, it, vi } from 'vitest'
import { stat } from 'node:fs/promises'
import * as binary from '../../codex/codex-hook-trust-derivation'
import * as claude from '../../claude/claude-hook-event-versions'
import { claudeWorkerVersion } from './claude-worker-version'

it('caches by executable fingerprint, probes in a disposable home, and rechecks replacement binaries', async () => {
  const fingerprint = vi
    .spyOn(binary, 'fingerprintCodex')
    .mockReturnValue('claude-test-fingerprint')
  const probe = vi.spyOn(claude, 'probeClaudeCliVersion').mockResolvedValue('2.1.309')
  try {
    expect(
      await Promise.all([claudeWorkerVersion('/fake/claude'), claudeWorkerVersion('/fake/claude')])
    ).toEqual(['2.1.309', '2.1.309'])
    expect(probe).toHaveBeenCalledOnce()
    const options = probe.mock.calls[0][1]!
    expect(options.env).toMatchObject({
      CLAUDE_CONFIG_DIR: options.cwd,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    })
    await expect(stat(options.cwd!)).rejects.toMatchObject({ code: 'ENOENT' })
    fingerprint.mockReturnValue('claude-test-replacement')
    await claudeWorkerVersion('/fake/claude')
    expect(probe).toHaveBeenCalledTimes(2)
    fingerprint.mockReturnValue(null)
    expect(await claudeWorkerVersion('/fake/missing')).toBeNull()
    expect(probe).toHaveBeenCalledTimes(2)
  } finally {
    vi.restoreAllMocks()
  }
})
