import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../src/shared/protocol-version'
import { RuntimeRpcEnvelopeSchema } from '../../../src/shared/runtime-rpc-envelope'

/** Uses the same IPC transport and mutation envelope as the renderer's axiomClient. */
export async function desktopCall(page: Page, method: string, params: unknown): Promise<unknown> {
  const raw = await page.evaluate((request) => window.api.runtime.call(request), {
    method,
    params,
    envelope: {
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: randomUUID()
    }
  })
  const envelope = RuntimeRpcEnvelopeSchema.parse(raw)
  if (!('ok' in envelope)) {
    throw new Error('Invalid runtime response')
  }
  if (!envelope.ok) {
    throw Object.assign(new Error(envelope.error.message), { code: envelope.error.code })
  }
  return envelope.result
}
