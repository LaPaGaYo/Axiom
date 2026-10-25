import type { WorkerArtifactChecks } from './worker-artifacts'
import type { DiffGateOutcome } from './diff-gate'
import { expect, it } from 'vitest'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { decideVerificationVerdict, type CheckOutcome } from './verification-verdict'
import { evaluateDiffGate } from './diff-gate'
import type { CandidateDiff } from './candidate-diff'

const validArtifacts: WorkerArtifactChecks = {
  required: true,
  checked: [],
  counts: { checked: 1, empty: 0, unreadable: 0, invalid_utf8: 0, invalid_json: 0 }
}

it.each([
  { checks: [{ result: 'pass' }], verdict: 'PASS', reason: 'checks_passed' },
  {
    checks: [
      { result: 'fail' },
      { result: 'environmental' },
      { result: 'inconclusive', reason: 'flaky' }
    ],
    verdict: 'FAIL',
    reason: 'checks_failed'
  },
  {
    checks: [{ result: 'pass' }, { result: 'environmental' }],
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    escalation: 'human'
  },
  {
    checks: [{ result: 'environmental' }, { result: 'inconclusive', reason: 'flaky' }],
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    escalation: 'human'
  },
  {
    checks: [{ result: 'pass' }, { result: 'inconclusive', reason: 'flaky' }],
    verdict: 'INCONCLUSIVE',
    reason: 'flaky',
    escalation: 'specialist'
  },
  {
    checks: [{ result: 'inconclusive', reason: 'known_flaky' }],
    verdict: 'INCONCLUSIVE',
    reason: 'known_flaky',
    escalation: 'specialist'
  },
  { checks: [], verdict: 'INCONCLUSIVE', reason: 'non_code', escalation: 'human' },
  {
    checks: [{ result: 'skipped', reason: 'time_budget_exhausted' }],
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    escalation: 'human'
  }
] satisfies {
  checks: CheckOutcome[]
  verdict: string
  reason: string
  escalation?: string
}[])('decides $reason from $checks', ({ checks, ...verdict }) => {
  expect(
    decideVerificationVerdict(
      checks,
      VerificationRulesSchema.parse({}),
      { outcome: 'clear' },
      !checks.length,
      validArtifacts
    )
  ).toEqual(verdict)
})
it('uses routing for flaky and artifact-only empty plans, never for environment', () => {
  expect(
    decideVerificationVerdict(
      [],
      VerificationRulesSchema.parse({ nonCodeTasks: 'artifact_only' }),
      { outcome: 'clear' },
      true,
      validArtifacts
    )
  ).toMatchObject({ escalation: 'specialist' })
  expect(
    decideVerificationVerdict(
      [{ result: 'inconclusive', reason: 'flaky' }],
      VerificationRulesSchema.parse({ inconclusiveRouting: 'human' }),
      { outcome: 'clear' },
      true,
      validArtifacts
    )
  ).toMatchObject({ escalation: 'human' })
})

it.each([
  {
    gate: { outcome: 'fail', reason: 'secret_detected' },
    checks: [{ result: 'fail' }],
    expected: { verdict: 'FAIL', reason: 'secret_detected' }
  },
  {
    gate: { outcome: 'fail', reason: 'scope_violation' },
    checks: [],
    expected: { verdict: 'FAIL', reason: 'scope_violation' }
  },
  {
    gate: { outcome: 'inconclusive', reason: 'dangerous_change' },
    checks: [{ result: 'fail' }],
    expected: { verdict: 'FAIL', reason: 'checks_failed' }
  },
  {
    gate: { outcome: 'inconclusive', reason: 'dangerous_change' },
    checks: [{ result: 'pass' }],
    expected: { verdict: 'INCONCLUSIVE', reason: 'dangerous_change', escalation: 'human' }
  },
  {
    gate: { outcome: 'inconclusive', reason: 'diff_too_large' },
    checks: [{ result: 'environmental' }],
    expected: { verdict: 'INCONCLUSIVE', reason: 'diff_too_large', escalation: 'human' }
  },
  {
    gate: {
      outcome: 'inconclusive',
      reason: 'environment',
      detail: 'integration_base_unavailable'
    },
    checks: [{ result: 'inconclusive', reason: 'flaky' }],
    expected: {
      verdict: 'INCONCLUSIVE',
      reason: 'environment',
      detail: 'integration_base_unavailable',
      escalation: 'human'
    }
  }
] satisfies {
  gate: DiffGateOutcome
  checks: CheckOutcome[]
  expected: unknown
}[])('uses gate and command precedence %#', ({ gate, checks, expected }) => {
  expect(
    decideVerificationVerdict(
      checks,
      VerificationRulesSchema.parse({}),
      gate,
      false,
      validArtifacts
    )
  ).toEqual(expected)
})

const rules = VerificationRulesSchema.parse({})
type VerdictInput = {
  diff: CandidateDiff
  checks: CheckOutcome[]
  artifacts: WorkerArtifactChecks
  nonCode: boolean
}
const precedence: { reason: string; apply: (input: VerdictInput) => void }[] = [
  {
    reason: 'secret_detected',
    apply: (v) => {
      if (v.diff.ok) {
        v.diff.addedText.set('outside', `gh${'p_'}${'Z'.repeat(36)}`)
      }
    }
  },
  {
    reason: 'scope_violation',
    apply: (v) => {
      if (v.diff.ok) {
        v.diff.changes.push({ path: 'outside', status: 'M' })
      }
    }
  },
  {
    reason: 'checks_failed',
    apply: (v) => {
      v.checks.push({ result: 'fail' })
    }
  },
  {
    reason: 'artifact_missing',
    apply: (v) => {
      v.nonCode = true
      v.artifacts.counts.checked = 0
    }
  },
  {
    reason: 'artifact_invalid',
    apply: (v) => {
      v.nonCode = true
      v.artifacts.counts.empty = 1
    }
  },
  {
    reason: 'environment',
    apply: (v) => {
      v.diff = { ok: false, reason: 'diff_unavailable' }
    }
  },
  {
    reason: 'environment',
    apply: (v) => {
      v.nonCode = true
      v.artifacts.counts.unreadable = 1
    }
  },
  {
    reason: 'diff_too_large',
    apply: (v) => {
      if (v.diff.ok) {
        v.diff.patchComplete = false
      }
    }
  },
  {
    reason: 'test_tampering',
    apply: (v) => {
      if (v.diff.ok) {
        v.diff.changes.push({ path: 'src/a.test.ts', status: 'M' })
        v.diff.addedText.set('src/a.test.ts', 'test.skip("x")')
      }
    }
  },
  {
    reason: 'dangerous_change',
    apply: (v) => {
      if (v.diff.ok) {
        v.diff.changes.push({ path: 'src/package.json', status: 'M' })
      }
    }
  },
  {
    reason: 'environment',
    apply: (v) => {
      v.checks.push({ result: 'environmental' })
    }
  },
  {
    reason: 'flaky',
    apply: (v) => {
      v.checks.push({ result: 'inconclusive', reason: 'flaky' })
    }
  },
  {
    reason: 'known_flaky',
    apply: (v) => {
      v.checks.push({ result: 'inconclusive', reason: 'known_flaky' })
    }
  },
  {
    reason: 'environment',
    apply: (v) => {
      v.checks.push({ result: 'skipped' })
    }
  },
  {
    reason: 'non_code',
    apply: (v) => {
      v.nonCode = true
    }
  },
  { reason: 'checks_passed', apply: () => {} }
]

it.each(precedence.slice(0, -1).map((first, i) => ({ first, second: precedence[i + 1] })))(
  'D65 adjacent precedence: $first.reason before $second.reason',
  ({ first, second }) => {
    const input: VerdictInput = {
      diff: {
        ok: true,
        integrationBase: { branch: 'base', sha: 'a' },
        mergeBase: 'a',
        candidateCommitSha: 'b',
        changes: [],
        addedText: new Map(),
        removedText: new Map(),
        binary: [],
        patchComplete: true
      },
      checks: [{ result: 'pass' }],
      artifacts: { ...validArtifacts, counts: { ...validArtifacts.counts } },
      nonCode: false
    }
    second.apply(input)
    first.apply(input)
    const gate = evaluateDiffGate({ diff: input.diff, rules, allowedPaths: ['src/'] })
    const result = decideVerificationVerdict(
      input.checks,
      rules,
      gate,
      input.nonCode,
      input.artifacts
    )
    expect(result.reason).toBe(first.reason)
    if (first.reason === 'test_tampering') {
      expect(result).toEqual({
        verdict: 'INCONCLUSIVE',
        reason: 'test_tampering',
        escalation: 'human'
      })
    }
  }
)

it('checks_failed outranks tampering but retains findings for the fix loop', () => {
  const gate = evaluateDiffGate({
    diff: {
      ok: true,
      integrationBase: { branch: 'base', sha: 'a' },
      mergeBase: 'a',
      candidateCommitSha: 'b',
      changes: [{ path: 'a.test.ts', status: 'M' }],
      addedText: new Map([['a.test.ts', 'test.skip("x")']]),
      removedText: new Map(),
      binary: [],
      patchComplete: true
    },
    rules,
    allowedPaths: ['.']
  })
  expect(
    decideVerificationVerdict([{ result: 'fail' }], rules, gate, false, validArtifacts)
  ).toEqual({ verdict: 'FAIL', reason: 'checks_failed' })
  expect(gate.tampering).toEqual([{ path: 'a.test.ts', rule: 'test_skip_added', count: 1 }])
})

it('ignores all Artifact problems for code Tasks and routes non-code unreadability before tampering', () => {
  const artifacts = {
    ...validArtifacts,
    counts: { checked: 5, empty: 1, unreadable: 1, invalid_utf8: 1, invalid_json: 1 }
  }
  expect(
    decideVerificationVerdict([{ result: 'pass' }], rules, { outcome: 'clear' }, false, artifacts)
  ).toEqual({ verdict: 'PASS', reason: 'checks_passed' })
  expect(
    decideVerificationVerdict(
      [{ result: 'pass' }],
      rules,
      { outcome: 'inconclusive', reason: 'test_tampering' },
      true,
      { ...validArtifacts, counts: { ...validArtifacts.counts, unreadable: 1 } }
    )
  ).toEqual({
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    detail: 'artifact_unreadable',
    escalation: 'human'
  })
})
