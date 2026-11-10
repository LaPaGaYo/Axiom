import { getMainE2EConfig } from '../../e2e-config'
import type { AttemptFailure } from '../../../shared/axiom-contract/attempt-failure'

export const INTERRUPTION_CHAIN_LIMIT = 3
export const INTERRUPTION_BACKOFF_MS = [60_000, 300_000, 900_000] as const
export const INTERRUPTION_RESET_SLACK_MS = 60_000
export const INTERRUPTION_MAX_RESET_MS = 8 * 24 * 60 * 60_000

function interruptionTiming() {
  const configured = getMainE2EConfig().enabled
    ? process.env.AXIOM_E2E_INTERRUPTION_BACKOFF_MS
    : undefined
  const ladder = configured?.split(',').map((value) => Number(value.trim()))
  return configured &&
    ladder?.length &&
    ladder.every((value) => Number.isSafeInteger(value) && value > 0)
    ? { ladder, slack: 0 }
    : { ladder: INTERRUPTION_BACKOFF_MS, slack: INTERRUPTION_RESET_SLACK_MS }
}

export function interruptionDueAt(failure: AttemptFailure, chain: number, now: number): string {
  const { ladder, slack } = interruptionTiming()
  const reset =
    failure.class === 'usage_limit' && failure.resetsAt ? Date.parse(failure.resetsAt) : Number.NaN
  const delay = ladder[Math.min(chain - 1, ladder.length - 1)] ?? INTERRUPTION_BACKOFF_MS[0]
  return new Date(
    reset > now && reset <= now + INTERRUPTION_MAX_RESET_MS ? reset + slack : now + delay
  ).toISOString()
}
