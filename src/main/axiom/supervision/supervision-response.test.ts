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
    expect(SupervisionUpdateResponse.parse(response.result)).toEqual({
      rules: [{ rule: 'stalled', globalMode: 'notify', globalSource: 'user' }],
      notifications: []
    })
  } finally {
    vi.restoreAllMocks()
    f.db.close()
  }
})
