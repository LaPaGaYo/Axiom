import { expect, it } from 'vitest'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import type { CandidateDiff } from './candidate-diff'
import { evaluateDiffGate, summarizeDiffGate } from './diff-gate'

const provider = `gh` + `p_${'x'.repeat(36)}`
function diff(paths: string[], overrides = {}): CandidateDiff {
  return {
    ok: true,
    integrationBase: { branch: 'axiom/integration/m', sha: 'a' },
    mergeBase: 'b',
    candidateCommitSha: 'c',
    changes: paths.map((path) => ({ path, status: 'M' })),
    addedText: new Map(),
    removedText: new Map(),
    binary: [],
    patchComplete: true,
    ...overrides
  }
}
function gate(value: CandidateDiff, allowedPaths = ['src/'], rules = {}) {
  return evaluateDiffGate({
    diff: value,
    allowedPaths,
    rules: VerificationRulesSchema.parse(rules)
  })
}
it('records violations for every status, ignored entries and generated paths in path order', () => {
  const value = diff(['z.ts', 'dist/app.js', 'a.ts', 'src/a.ts'], {
    changes: [
      { path: 'z.ts', status: 'D' },
      { path: 'dist/app.js', status: 'A' },
      { path: 'a.ts', status: 'M' },
      { path: 'src/a.ts', status: 'M' }
    ]
  })
  expect(gate(value, ['src/', '../a.ts', '/z.ts'])).toMatchObject({
    outcome: 'fail',
    reason: 'scope_violation',
    scopeViolations: ['a.ts', 'dist/app.js', 'z.ts'],
    ignoredScopeEntries: ['../a.ts', '/z.ts'],
    generated: ['dist/app.js']
  })
})
it('requires explicit dangerous scope and records only the first applicable pattern', () => {
  const value = diff(['package.json', 'src/storage/AGENTS.md', '.github/workflows/ci.yml'])
  expect(gate(value, ['.'])).toMatchObject({
    outcome: 'inconclusive',
    reason: 'dangerous_change',
    dangerous: [
      { path: '.github/workflows/ci.yml', pattern: '.github/workflows/**' },
      { path: 'package.json', pattern: '**/package.json' },
      { path: 'src/storage/AGENTS.md', pattern: '**/AGENTS.md' }
    ]
  })
  expect(
    gate(value, ['package.json', 'src/storage/AGENTS.md', '.github/workflows/'])
  ).toMatchObject({ outcome: 'clear', dangerous: [] })
  expect(
    gate(diff(['src/package.json']), ['src/'], {
      dangerousPathPatterns: ['**/package.json', 'src/package.json']
    }).dangerous
  ).toEqual([{ path: 'src/package.json', pattern: '**/package.json' }])
})
it('retains all findings while secrets outrank scope, truncation and dangerous changes', () => {
  const value = diff(['z.ts', 'pkg/package.json', 'dist/a.js'], {
    addedText: new Map([
      ['z.ts', provider],
      ['dist/a.js', 'custom_123']
    ]),
    patchComplete: false
  })
  expect(
    gate(value, ['pkg/', 'dist/'], {
      secretPatterns: ['custom_\\d+']
    })
  ).toMatchObject({
    outcome: 'fail',
    reason: 'secret_detected',
    scopeViolations: ['z.ts'],
    dangerous: [{ path: 'pkg/package.json', pattern: '**/package.json' }],
    secrets: [
      { path: 'dist/a.js', pattern: 'policy:0' },
      { path: 'z.ts', pattern: 'provider_token' }
    ],
    generated: ['dist/a.js']
  })
})
it.each([
  {
    value: { ok: false, reason: 'diff_unavailable' } satisfies CandidateDiff,
    expected: { outcome: 'inconclusive', reason: 'environment', detail: 'diff_unavailable' }
  },
  {
    value: diff(['outside'], { patchComplete: false }),
    expected: { outcome: 'fail', reason: 'scope_violation' }
  },
  {
    value: diff(['src/package.json'], { patchComplete: false }),
    expected: { outcome: 'inconclusive', reason: 'diff_too_large' }
  },
  {
    value: diff(['src/package.json']),
    expected: { outcome: 'inconclusive', reason: 'dangerous_change' }
  },
  { value: diff(['src/a.ts']), expected: { outcome: 'clear' } }
])('applies gate precedence %#', ({ value, expected }) =>
  expect(gate(value)).toMatchObject(expected)
)
it('records generated paths without rejecting them when explicitly allowed', () => {
  const paths = [
    'out/a',
    'src/dist/b',
    'nested/x.lock',
    'pnpm-lock.yaml',
    'package-lock.json',
    'bun.lockb'
  ]
  expect(gate(diff(paths), paths)).toMatchObject({ outcome: 'clear', generated: [...paths].sort() })
})
it('caps every persisted list independently and preserves full counts and resolved identities', () => {
  const paths = Array.from({ length: 1002 }, (_, i) => `file-${String(i).padStart(4, '0')}`)
  const value = diff(paths, {
    addedText: new Map(paths.map((p) => [p, `${provider}\n/* c8 ignore next */`])),
    binary: paths
  })
  const result = gate(value, Array(1002).fill('../invalid'))
  for (const limit of [50, 1000]) {
    const summary = summarizeDiffGate(value, result, limit)
    expect(summary).toMatchObject({
      integrationBase: { sha: 'a' },
      mergeBase: 'b',
      changedPaths: 1002,
      counts: {
        scopeViolations: 1002,
        secrets: 1002,
        binary: 1002,
        ignoredScopeEntries: 1002,
        tampering: 1002
      }
    })
    if ('error' in summary) {
      throw new Error('Expected diff summary')
    }
    expect(summary.scopeViolations).toHaveLength(limit)
    expect(summary.secrets).toHaveLength(limit)
    expect(summary.binary).toHaveLength(limit)
    expect(summary.ignoredScopeEntries).toHaveLength(limit)
    expect(summary.tampering).toHaveLength(limit)
    expect(JSON.stringify(summary).includes(provider)).toBe(false)
  }
  const failure: CandidateDiff = {
    ok: false,
    reason: 'diff_unavailable',
    integrationBase: { branch: 'base', sha: 'a' },
    mergeBase: 'b'
  }
  expect(summarizeDiffGate(failure, gate(failure), 50)).toEqual({
    error: 'diff_unavailable',
    integrationBase: failure.integrationBase,
    mergeBase: 'b'
  })
})
it('does not run content rules on an incomplete patch', () => {
  const result = gate(
    diff(['src/a.test.ts'], {
      patchComplete: false,
      addedText: new Map([['src/a.test.ts', 'test.skip("x")']])
    })
  )
  expect(result).toMatchObject({ reason: 'diff_too_large', tampering: [] })
})
