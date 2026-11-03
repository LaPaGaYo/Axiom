import { z } from 'zod'
import { VerificationAcceptanceSchema } from '../../../shared/axiom-contract/verification-acceptance'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import type { AxiomStore } from '../db/axiom-store'
import { quote, quoteLine } from './previous-attempt-text'

export const PreviousChecks = z.array(
  z.object({
    index: z.number(),
    command: z.string(),
    result: z.string(),
    exitCode: z.number().nullable(),
    failures: z.array(z.string()).default([])
  })
)

export function acceptanceLines(detail: Record<string, unknown>): string[] {
  const acceptance = VerificationAcceptanceSchema.array().safeParse(detail.acceptance)
  if (!acceptance.success) {
    return []
  }
  const checks = PreviousChecks.safeParse(detail.checks)
  return acceptance.data.map((criterion) => {
    const prefix = `[${criterion.result}] ${quote(criterion.text)}`
    if (criterion.result === 'human') {
      return `${prefix} — a person confirms this; do not try to prove it with code changes`
    }
    if (criterion.result === 'fail' && criterion.check.kind === 'command') {
      const failures = new Set(
        (checks.success ? checks.data : [])
          .filter((check) => criterion.checkIndexes.includes(check.index))
          .flatMap((check) => check.failures)
      )
      return `${prefix} — ${quoteLine(criterion.check.command)} (${failures.size} failures)`
    }
    return prefix
  })
}

function failureNames(run: VerificationRun): Set<string> {
  const checks = PreviousChecks.safeParse(run.verdictDetail.checks)
  return new Set(
    (checks.success ? checks.data : [])
      .filter((check) => check.result === 'fail')
      .flatMap((check) => check.failures)
  )
}

export function persistentFailures(
  store: AxiomStore,
  latest: VerificationRun
): Map<string, number> {
  const result = new Map<string, number>()
  if (latest.status !== 'FAIL') {
    return result
  }
  // Attempt sequence is authoritative when two runs share the store's whole-second timestamp.
  const runs = store
    .listVerificationRuns({ missionId: latest.missionId, taskId: latest.taskId })
    .map((run) => {
      const candidate = store.getCandidate(run.candidateId)
      const binding = candidate && store.getAttemptBindingByDispatch(candidate.attemptId)
      return { run, seq: binding?.seq, failures: failureNames(run) }
    })
    .sort(
      (a, b) =>
        (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
        a.run.createdAt.localeCompare(b.run.createdAt) ||
        a.run.id.localeCompare(b.run.id)
    )
  const latestIndex = runs.findIndex(({ run }) => run.id === latest.id)
  if (latestIndex < 1) {
    return result
  }
  const history = runs.slice(0, latestIndex)
  for (const name of failureNames(latest)) {
    let first: (typeof history)[number] | undefined
    for (let index = history.length - 1; index >= 0; index--) {
      if (!history[index].failures.has(name)) {
        break
      }
      first = history[index]
    }
    if (first?.seq !== undefined) {
      result.set(name, first.seq)
    }
  }
  return result
}
