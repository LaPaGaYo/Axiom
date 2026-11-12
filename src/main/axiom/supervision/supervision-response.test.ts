import { expect, it, vi } from 'vitest'
import { rpcFixture } from '../rpc-fixture.test-support'
import { SupervisionUpdateResponse } from '../../../shared/axiom-contract/supervision'

it('decodes the desktop update response with its kernel mutation receipt', async () => {
  const f = rpcFixture()
  try {
    const response = await f.call('axiom.supervision.update', { rule: 'stalled', mode: 'notify' })
    expect(response).toMatchObject({ ok: true, result: { mutation: { replayed: false } } })
    if (!response.ok) {
      throw new Error(response.error.code)
    }
    const empty = {
      hits: 0,
      falsePositives: 0,
      known: 0,
      inconclusive: 0,
      hitRate: null,
      savedMs: 0,
      sinceSequence: 0,
      throughSequence: 0
    }
    expect(SupervisionUpdateResponse.parse(response.result)).toEqual({
      rules: [{ rule: 'stalled', globalMode: 'notify', globalSource: 'user' }],
      notifications: [],
      evidence: [{ rule: 'stalled', window: empty, total: empty }],
      proposals: []
    })
  } finally {
    vi.restoreAllMocks()
    f.db.close()
  }
})
