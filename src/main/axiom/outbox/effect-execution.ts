import { z } from 'zod'
import type { AxiomStore } from '../db/axiom-store'
import { redactContext } from '../context-builder/redaction'
import {
  EffectTimestampSchema,
  type Effect,
  type EffectKind,
  type EffectOf
} from '../../../shared/axiom-contract/effects'

const ExecutionResult = z.union([
  z.literal('done'),
  z.strictObject({ later: EffectTimestampSchema })
])
const OrphanResult = z.union([
  z.literal('retry'),
  z.literal('done'),
  z.strictObject({ retire: z.string().min(1) })
])
export type EffectExecutionResult = z.infer<typeof ExecutionResult>
export type EffectOrphanResult = z.infer<typeof OrphanResult>
export type EffectExecutor<K extends EffectKind> = {
  execute: (effect: EffectOf<K>) => EffectExecutionResult | Promise<EffectExecutionResult>
  maxAttempts: number
  backoffMs: readonly number[]
  onExhausted?: (effect: EffectOf<K>) => void | Promise<void>
  onOrphan: (effect: EffectOf<K>) => EffectOrphanResult | Promise<EffectOrphanResult>
}

function hasKind<K extends EffectKind>(effect: Effect, kind: K): effect is EffectOf<K> {
  return effect.kind === kind
}

/** The runtime discriminator preserves the registration's payload type without assertions. */
export function bindEffectExecutor<K extends EffectKind>(
  kind: K,
  executor: EffectExecutor<K>
): EffectExecutor<EffectKind> {
  const policy = z
    .object({
      maxAttempts: z.number().int().positive(),
      backoffMs: z.array(z.number().finite().nonnegative())
    })
    .parse(executor)
  if (policy.backoffMs.length < policy.maxAttempts - 1) {
    throw new Error('Effect retry policy needs one backoff per retry')
  }
  function typed(effect: Effect): EffectOf<K> {
    if (!hasKind(effect, kind)) {
      throw new Error('Effect executor kind mismatch')
    }
    return effect
  }
  return {
    ...policy,
    execute: (effect) => executor.execute(typed(effect)),
    onOrphan: (effect) => executor.onOrphan(typed(effect)),
    onExhausted: (effect) => executor.onExhausted?.(typed(effect))
  }
}

function fence(effect: Effect) {
  return {
    id: effect.id,
    expectedStatus: 'running' as const,
    expectedLeaseEpoch: effect.leaseEpoch
  }
}

export function appendEffectAudit(
  store: AxiomStore,
  effect: Effect,
  event: string,
  after: Record<string, string | number | null>
) {
  store.appendAuditEvent({
    missionId: effect.missionId,
    actor: 'EffectOutbox',
    objectKind: 'effect',
    objectId: effect.id,
    event,
    before: null,
    after,
    createdAt: new Date().toISOString()
  })
}

export async function executeEffect(
  store: AxiomStore,
  effect: Effect,
  executor: EffectExecutor<EffectKind>
): Promise<void> {
  let result: EffectExecutionResult
  try {
    result = ExecutionResult.parse(await executor.execute(effect))
  } catch (error) {
    const lastError = redactContext(
      error instanceof Error ? error.message : String(error)
    ).content.slice(0, 2000)
    const failures = effect.attempts + 1
    const nextDueAt =
      failures >= executor.maxAttempts
        ? null
        : new Date(Date.now() + z.number().parse(executor.backoffMs[failures - 1])).toISOString()
    const updated = store.transaction('effect_failure', () => {
      const failed = store.failEffectAttempt({ ...fence(effect), lastError, nextDueAt })
      if (failed?.status === 'failed') {
        appendEffectAudit(store, failed, 'effect.failed', {
          kind: failed.kind,
          key: failed.key,
          attempts: failed.attempts,
          lastError: failed.lastError
        })
      }
      return failed
    })
    if (updated?.status === 'failed') {
      await executor.onExhausted?.(updated)
    }
    return
  }
  if (result === 'done') {
    store.completeEffect(fence(effect))
  } else {
    store.deferEffect({ ...fence(effect), dueAt: result.later })
  }
}

export async function recoverEffect(
  store: AxiomStore,
  effect: Effect,
  executor: EffectExecutor<EffectKind>
): Promise<void> {
  const result = OrphanResult.parse(await executor.onOrphan(effect))
  if (result === 'done') {
    store.completeEffect(fence(effect))
  } else if (result === 'retry') {
    store.deferEffect({ ...fence(effect), dueAt: new Date().toISOString() })
  } else {
    const reason = redactContext(result.retire).content.slice(0, 2000)
    store.transaction('effect_retirement', () => {
      const retired = store.retireEffect({ ...fence(effect), reason })
      if (retired) {
        appendEffectAudit(store, retired, 'effect.retired', {
          kind: retired.kind,
          key: retired.key,
          reason
        })
      }
    })
  }
}
