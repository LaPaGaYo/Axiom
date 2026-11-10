import { createHash } from 'node:crypto'
import type { AxiomStore } from '../db/axiom-store'

/** Exact launch-home spelling is part of identity; paths never enter continuation payloads. */
export function accountKey(provider: string, home: string): string {
  return createHash('sha256')
    .update(JSON.stringify([provider, home]))
    .digest('hex')
}

export async function readAccountCooldown(
  store: AxiomStore,
  homes: {
    claude: () => Promise<string | null>
    codex: () => string | null
  },
  now: () => number
): Promise<ReadonlyMap<string, string>> {
  const at = now()
  const candidates = store.listEffects({ status: 'pending' }).flatMap((effect) => {
    if (
      effect.kind !== 'attempt.continue' ||
      effect.payload.failureClass !== 'usage_limit' ||
      !effect.payload.account ||
      Date.parse(effect.dueAt) <= at
    ) {
      return []
    }
    const task = store.getTaskStage(effect.payload.taskId)
    return task?.stage === 'READY' &&
      task.missionId === effect.missionId &&
      store.nextAttemptSeq(task.taskId) <= effect.payload.seq + 1
      ? [{ ...effect.payload.account, until: effect.dueAt }]
      : []
  })
  const cooling = new Map<string, string>()
  for (const provider of new Set(candidates.map((effect) => effect.provider))) {
    let home: string | null
    try {
      home = provider === 'claude' || provider === 'codex' ? await homes[provider]() : null
    } catch {
      continue
    }
    if (!home) {
      continue
    }
    const key = accountKey(provider, home)
    for (const effect of candidates) {
      const previous = cooling.get(provider)
      if (
        effect.provider === provider &&
        effect.key === key &&
        (!previous || Date.parse(effect.until) > Date.parse(previous))
      ) {
        cooling.set(provider, effect.until)
      }
    }
  }
  return cooling
}
