import { z } from 'zod'
import { AxiomRpcError } from '@/lib/axiom-rpc-call'

const RefusalDetail = z.object({
  errors: z.array(z.unknown()).catch([]),
  reason: z.string().optional().catch(undefined)
})
const RefusalMessage = z.object({ message: z.string() })

export function missionErrorText(failure: unknown): string {
  if (!(failure instanceof AxiomRpcError)) {
    return String(failure)
  }
  let detail = failure.message
  if (detail === failure.code) {
    const parsed = RefusalDetail.safeParse(failure.data)
    if (parsed.success) {
      const messages = parsed.data.errors.flatMap((error) => {
        const entry = RefusalMessage.safeParse(error)
        return entry.success ? [entry.data.message] : []
      })
      detail = messages.length ? [...new Set(messages)].join(' ') : (parsed.data.reason ?? detail)
    }
  }
  return `${failure.code}: ${detail}`
}
