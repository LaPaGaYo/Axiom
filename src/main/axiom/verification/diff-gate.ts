import {
  isExplicitlyInScope,
  matchesPathPattern,
  normalizePathPattern
} from '../../../shared/axiom-contract/path-patterns'
import type { VerificationRules } from '../../../shared/axiom-contract/verification-rules'
import { detectSecretPatterns } from '../context-builder/redaction'
import type { CandidateDiff } from './candidate-diff'

export const GENERATED_PATH_PATTERNS = [
  '**/out/**',
  '**/dist/**',
  '**/*.lock',
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/bun.lockb'
]
export type DiffGateOutcome =
  | { outcome: 'clear' }
  | { outcome: 'fail'; reason: 'secret_detected' | 'scope_violation' }
  | {
      outcome: 'inconclusive'
      reason: 'environment' | 'diff_too_large' | 'dangerous_change'
      detail?: string
    }
export type DiffGate = DiffGateOutcome & {
  ignoredScopeEntries: string[]
  scopeViolations: string[]
  dangerous: { path: string; pattern: string }[]
  secrets: { path: string; pattern: string }[]
  generated: string[]
}

export function evaluateDiffGate(input: {
  diff: CandidateDiff
  allowedPaths: readonly string[]
  rules: VerificationRules
}): DiffGate {
  const { diff, allowedPaths, rules } = input
  const ignoredScopeEntries = allowedPaths
    .filter((entry) => normalizePathPattern(entry) === null)
    .sort()
  const scopeViolations: string[] = []
  const dangerous: DiffGate['dangerous'] = []
  const secrets: DiffGate['secrets'] = []
  const generated: string[] = []
  const findings = { ignoredScopeEntries, scopeViolations, dangerous, secrets, generated }
  if (!diff.ok) {
    return { ...findings, outcome: 'inconclusive', reason: 'environment', detail: diff.reason }
  }
  const paths = diff.changes.map(({ path }) => path).sort()
  for (const path of paths) {
    if (!allowedPaths.some((entry) => matchesPathPattern(path, entry))) {
      scopeViolations.push(path)
    } else {
      const pattern = rules.dangerousPathPatterns.find(
        (entry) =>
          matchesPathPattern(path, entry) && !isExplicitlyInScope(path, entry, allowedPaths)
      )
      if (pattern !== undefined) {
        dangerous.push({ path, pattern })
      }
    }
    if (GENERATED_PATH_PATTERNS.some((entry) => matchesPathPattern(path, entry))) {
      generated.push(path)
    }
  }
  for (const path of [...diff.addedText.keys()].sort()) {
    for (const pattern of detectSecretPatterns(diff.addedText.get(path)!, rules.secretPatterns)) {
      secrets.push({ path, pattern })
    }
  }
  if (secrets.length) {
    return { ...findings, outcome: 'fail', reason: 'secret_detected' }
  }
  if (scopeViolations.length) {
    return { ...findings, outcome: 'fail', reason: 'scope_violation' }
  }
  if (!diff.patchComplete) {
    return { ...findings, outcome: 'inconclusive', reason: 'diff_too_large' }
  }
  if (dangerous.length) {
    return { ...findings, outcome: 'inconclusive', reason: 'dangerous_change' }
  }
  return { ...findings, outcome: 'clear' }
}

/** Shared evidence shape; raw patches and matched text never enter durable evidence. */
export function summarizeDiffGate(diff: CandidateDiff, gate: DiffGate, limit: number) {
  if (!diff.ok) {
    return {
      error: diff.reason,
      ...(diff.integrationBase ? { integrationBase: diff.integrationBase } : {}),
      ...(diff.mergeBase ? { mergeBase: diff.mergeBase } : {})
    }
  }
  const { scopeViolations, dangerous, secrets, generated, ignoredScopeEntries } = gate
  return {
    integrationBase: diff.integrationBase,
    mergeBase: diff.mergeBase,
    changedPaths: diff.changes.length,
    scopeViolations: scopeViolations.slice(0, limit),
    dangerous: dangerous.slice(0, limit),
    secrets: secrets.slice(0, limit),
    generated: generated.slice(0, limit),
    binary: [...diff.binary].sort().slice(0, limit),
    ignoredScopeEntries: ignoredScopeEntries.slice(0, limit),
    patchComplete: diff.patchComplete,
    counts: {
      scopeViolations: scopeViolations.length,
      dangerous: dangerous.length,
      secrets: secrets.length,
      generated: generated.length,
      binary: diff.binary.length,
      ignoredScopeEntries: ignoredScopeEntries.length
    }
  }
}
