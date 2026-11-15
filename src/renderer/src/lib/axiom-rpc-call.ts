import type { z } from 'zod'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import { RuntimeRpcEnvelopeSchema } from '../../../shared/runtime-rpc-envelope'

export class AxiomRpcError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AxiomRpcError'
  }
}

export async function call<P, R>(
  method: string,
  params: P,
  paramsSchema: z.ZodType<P>,
  responseSchema: z.ZodType<R>,
  requestId?: string
): Promise<R> {
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) {
    throw new AxiomRpcError('invalid_params', parsed.error.message)
  }
  let raw: unknown
  try {
    raw = await window.api.runtime.call({
      method,
      params: parsed.data,
      ...(requestId === undefined
        ? {}
        : {
            envelope: {
              orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
              orchestrationRequestId: requestId
            }
          })
    })
  } catch (error) {
    throw new AxiomRpcError(
      'transport_error',
      error instanceof Error ? error.message : String(error)
    )
  }
  const envelope = RuntimeRpcEnvelopeSchema.safeParse(raw)
  if (!envelope.success || !('ok' in envelope.data)) {
    throw new AxiomRpcError('invalid_response', 'Invalid runtime response')
  }
  if (!envelope.data.ok) {
    throw new AxiomRpcError(envelope.data.error.code, envelope.data.error.message)
  }
  const result = responseSchema.safeParse(envelope.data.result)
  if (!result.success) {
    throw new AxiomRpcError('invalid_response', 'Invalid Axiom response')
  }
  return result.data
}
