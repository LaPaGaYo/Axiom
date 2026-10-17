import type { HandlerContext } from '../../dispatch'
import { printResult } from '../../format'
import { readRetryRequestFlag } from '../../retry-request-flag'

export async function callAxiom<T>(
  ctx: HandlerContext,
  method: string,
  params: unknown,
  formatter: (value: T) => string
) {
  const result = await ctx.client.call<T>(method, params, {
    orchestrationRequestId: readRetryRequestFlag(ctx.flags)
  })
  printResult(result, ctx.json, formatter)
}
