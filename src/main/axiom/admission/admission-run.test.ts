import { afterEach, describe, expect, it, vi } from 'vitest'
import { admissionFixture } from './admission-fixture.test-support'

describe('§4b runUse takeover admission', () => {
  let f: ReturnType<typeof admissionFixture>
  afterEach(() => f?.cleanup())

  it.each([true, false])('takeoverLegacy with attested terminal, managed=%s', async (managed) => {
    f = admissionFixture(managed, false)
    vi.spyOn(f.runtime, 'verifyOrchestrationCompatibilityCaller').mockReturnValue({
      terminalHandle: 'term_worker',
      paneKey: f.workerPaneKey,
      processIncarnation: 'runtime_test:term_worker:1',
      launchTokenHash: 'verified-test-hash',
      hostScope: { kind: 'local', hostId: 'local' }
    })
    const before = f.snapshot()
    const result = await f.call(
      'runUse',
      { id: f.runId, from: 'term_worker', takeoverLegacy: true },
      {
        orchestrationCompatibilityEvidence: {
          terminalHandle: 'term_worker',
          paneKey: f.workerPaneKey,
          launchToken: 'test-proof'
        }
      }
    )
    if (managed) {
      f.refusal(result, 'runUse')
      expect(f.snapshot()).toEqual(before)
    } else {
      // A fresh non-Mission Run is not the adopted legacy Run: preserve this refusal.
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
      expect(f.snapshot()).toEqual(before)
    }
  })

  it('preserves run_not_found before any rebind', async () => {
    f = admissionFixture()
    const before = f.snapshot()
    expect(await f.call('runUse', { id: 'missing', from: 'term_worker' })).toMatchObject({
      ok: false,
      error: { code: 'run_not_found' }
    })
    expect(f.snapshot()).toEqual(before)
  })
})
