import type { Policy } from '../../../../shared/axiom-contract/mission-objects'
import { PolicyUpdateParams } from '../../../../shared/axiom-contract/policy-params'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'

export const POLICY_FIELDS = [
  'concurrency',
  'setup',
  'low',
  'medium',
  'high',
  'integration',
  'minutes'
] as const
export type PolicyDraft = Record<(typeof POLICY_FIELDS)[number], string>

export function readPolicyRules(policy: Policy) {
  const parsed = VerificationRulesSchema.safeParse(policy.verificationRules)
  return parsed.success ? parsed.data : null
}

export function openPolicyDraft(policy: Policy | null): PolicyDraft {
  const rules = policy ? readPolicyRules(policy) : null
  return {
    concurrency: policy ? String(policy.concurrencyLimit) : '',
    setup: rules?.setupCommands.join('\n') ?? '',
    low: rules?.repositoryGates.low?.join('\n') ?? '',
    medium: rules?.repositoryGates.medium?.join('\n') ?? '',
    high: rules?.repositoryGates.high?.join('\n') ?? '',
    integration: rules?.integrationGates?.join('\n') ?? '',
    minutes: rules ? String(rules.timeBudgetMinutes) : ''
  }
}

function commands(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function buildPolicyUpdate(
  missionId: string,
  policy: Policy | null,
  opened: PolicyDraft,
  draft: PolicyDraft
) {
  const rules = policy ? readPolicyRules(policy) : null
  const changed = POLICY_FIELDS.filter(
    (field) => draft[field] !== opened[field] && (rules || field === 'concurrency')
  )
  const invalidNumbers = changed.filter(
    (field) =>
      (field === 'concurrency' || field === 'minutes') &&
      (!/^\d+$/.test(draft[field]) ||
        !Number.isSafeInteger(Number(draft[field])) ||
        Number(draft[field]) < 1)
  )
  if (!policy || !changed.length || invalidNumbers.length) {
    return { changed, invalidNumbers, params: null, error: null }
  }
  const patch: { concurrencyLimit?: number; verificationRules?: Policy['verificationRules'] } = {}
  if (changed.includes('concurrency')) {
    patch.concurrencyLimit = Number(draft.concurrency)
  }
  if (rules && changed.some((field) => field !== 'concurrency')) {
    const next = { ...policy.verificationRules }
    const gates = { ...rules.repositoryGates }
    for (const level of ['low', 'medium', 'high'] as const) {
      if (changed.includes(level)) {
        const lines = commands(draft[level])
        if (lines.length) {
          gates[level] = lines
        } else {
          delete gates[level]
        }
        next.repositoryGates = gates
      }
    }
    if (changed.includes('setup')) {
      next.setupCommands = commands(draft.setup)
    }
    if (changed.includes('integration')) {
      const lines = commands(draft.integration)
      if (lines.length) {
        next.integrationGates = lines
      } else {
        delete next.integrationGates
      }
    }
    if (changed.includes('minutes')) {
      next.timeBudgetMinutes = Number(draft.minutes)
    }
    patch.verificationRules = next
  }
  const parsed = PolicyUpdateParams.safeParse({ missionId, patch })
  return {
    changed,
    invalidNumbers,
    params: parsed.success ? parsed.data : null,
    error: parsed.success ? null : parsed.error.issues[0]?.message
  }
}
