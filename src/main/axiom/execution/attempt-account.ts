import { z } from 'zod'
import type { AttemptContinuePayloadSchema } from '../../../shared/axiom-contract/effects'
import type { AxiomStore } from '../db/axiom-store'
import { accountKey } from '../agent-factory/account-cooldown'

const AccountHome = z.object({ kind: z.literal('account'), path: z.string().min(1) })
const LaunchAccount = z.object({
  combination: z.object({
    effective: z.object({
      claudeConfigDir: z.unknown().optional(),
      codexHome: z.unknown().optional()
    })
  })
})

export function readAttemptAccount(
  store: AxiomStore,
  missionId: string,
  dispatchId: string,
  provider: string
):
  | {
      account: NonNullable<z.infer<typeof AttemptContinuePayloadSchema>['account']>
      home: string
    }
  | undefined {
  if (provider !== 'claude' && provider !== 'codex') {
    return undefined
  }
  try {
    const audit = store
      .listAuditEvents({ missionId })
      .findLast(
        (event) => event.objectId === dispatchId && event.event === 'attempt.headless_prepared'
      )
    const parsed = LaunchAccount.safeParse(audit?.after)
    if (!parsed.success) {
      return undefined
    }
    const effective = parsed.data.combination.effective
    const home = AccountHome.safeParse(
      provider === 'claude' ? effective.claudeConfigDir : effective.codexHome
    )
    return home.success
      ? { account: { provider, key: accountKey(provider, home.data.path) }, home: home.data.path }
      : undefined
  } catch {
    // Account evidence is optional; an unreadable legacy audit must not lose the settlement.
    return undefined
  }
}
