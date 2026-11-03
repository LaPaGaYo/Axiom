import { expect, it } from 'vitest'
import type { AcceptanceCriterion } from '../../../shared/axiom-contract/mission-objects'
import { VerificationAcceptanceSchema } from '../../../shared/axiom-contract/verification-acceptance'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { evaluateAcceptance } from './verification-acceptance'
import { decideVerificationVerdict } from './verification-verdict'
import type { WorkerArtifactChecks } from './worker-artifacts'

const criteria: AcceptanceCriterion[] = [
  { text: 'First', check: { kind: 'command', command: 'pnpm test' } },
  { text: 'Second', check: { kind: 'command', command: 'pnpm tc' } }
]
const artifacts: WorkerArtifactChecks = {
  required: false,
  checked: [],
  counts: { checked: 0, empty: 0, unreadable: 0, invalid_utf8: 0, invalid_json: 0 }
}
const rules = VerificationRulesSchema.parse({})

it.each(['pass', 'fail', 'environmental', 'inconclusive', 'skipped'] as const)(
  'maps a command %s to its criterion without affecting the passing criterion',
  (result) => {
    const checks = [
      { index: 0, criteria: [0], result: 'pass' as const },
      { index: 1, criteria: [1], result }
    ]
    const acceptance = evaluateAcceptance(criteria, checks, artifacts)
    expect(acceptance).toEqual([
      { index: 0, ...criteria[0], result: 'pass', checkIndexes: [0], artifactIds: [] },
      {
        index: 1,
        ...criteria[1],
        result: result === 'environmental' ? 'inconclusive' : result,
        checkIndexes: [1],
        artifactIds: []
      }
    ])
    expect(VerificationAcceptanceSchema.array().parse(acceptance)).toEqual(acceptance)
    expect(
      decideVerificationVerdict(checks, rules, { outcome: 'clear' }, false, artifacts, acceptance)
        .verdict
    ).toBe(result === 'pass' ? 'PASS' : result === 'fail' ? 'FAIL' : 'INCONCLUSIVE')
  }
)
it('never treats a missing command result as proof', () => {
  const acceptance = evaluateAcceptance(criteria, [], artifacts)
  expect(acceptance.map((entry) => entry.result)).toEqual(['inconclusive', 'inconclusive'])
  expect(
    decideVerificationVerdict([], rules, { outcome: 'clear' }, false, artifacts, acceptance)
  ).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'environment' })
})
it('links a deduplicated command to all its criteria', () => {
  const acceptance = evaluateAcceptance(
    [criteria[0], criteria[0]],
    [{ index: 3, criteria: [0, 1], result: 'fail' }],
    artifacts
  )
  expect(acceptance.map((entry) => entry.checkIndexes)).toEqual([[3], [3]])
  expect(acceptance.map((entry) => entry.result)).toEqual(['fail', 'fail'])
})
it('requires an Artifact of the declared kind and records its proof reference', () => {
  const criterion: AcceptanceCriterion = {
    text: 'Report',
    check: { kind: 'artifact', artifactKind: 'evidence' }
  }
  const wrong: WorkerArtifactChecks = {
    ...artifacts,
    checked: [{ id: 'a', kind: 'log', bytes: 4, mediaType: 'text/plain' }]
  }
  const missing = evaluateAcceptance([criterion], [], wrong)
  expect(missing[0].result).toBe('fail')
  expect(decideVerificationVerdict([], rules, { outcome: 'clear' }, false, wrong, missing)).toEqual(
    { verdict: 'FAIL', reason: 'artifact_missing' }
  )
  const good: WorkerArtifactChecks = {
    ...artifacts,
    checked: [
      { id: 'bad', kind: 'evidence', bytes: 0, mediaType: 'text/plain', problem: 'empty' },
      { id: 'proof', kind: 'evidence', bytes: 4, mediaType: 'text/plain' }
    ]
  }
  expect(evaluateAcceptance([criterion], [], good)[0]).toEqual({
    index: 0,
    ...criterion,
    result: 'pass',
    checkIndexes: [],
    artifactIds: ['proof']
  })
  const invalid: WorkerArtifactChecks = { ...good, checked: good.checked.slice(0, 1) }
  expect(
    decideVerificationVerdict(
      [],
      rules,
      { outcome: 'clear' },
      false,
      invalid,
      evaluateAcceptance([criterion], [], invalid)
    )
  ).toEqual({ verdict: 'FAIL', reason: 'artifact_invalid' })
})
it('leaves human criteria for a person after machine checks pass', () => {
  const human: AcceptanceCriterion = { text: 'Looks right', check: { kind: 'human' } }
  const checks = [{ index: 0, criteria: [0], result: 'pass' as const }]
  const acceptance = evaluateAcceptance([criteria[0], human], checks, artifacts)
  expect(acceptance[1]).toEqual({
    index: 1,
    ...human,
    result: 'human',
    checkIndexes: [],
    artifactIds: []
  })
  expect(
    decideVerificationVerdict(checks, rules, { outcome: 'clear' }, false, artifacts, acceptance)
  ).toEqual({ verdict: 'INCONCLUSIVE', reason: 'acceptance_human', escalation: 'human', detail: 1 })
  const nonCode = { ...artifacts, counts: { ...artifacts.counts, checked: 1 } }
  expect(
    decideVerificationVerdict(
      [],
      rules,
      { outcome: 'clear' },
      true,
      nonCode,
      evaluateAcceptance([human], [], nonCode)
    )
  ).toEqual({ verdict: 'INCONCLUSIVE', reason: 'non_code', escalation: 'human' })
})
it('requires readable proof for explicit artifact criteria while retaining implicit non-code routing', () => {
  const unreadable: WorkerArtifactChecks = {
    required: true,
    checked: [
      {
        id: 'missing',
        kind: 'evidence',
        bytes: null,
        mediaType: 'text/plain',
        problem: 'unreadable'
      }
    ],
    counts: { ...artifacts.counts, checked: 1, unreadable: 1 }
  }
  const explicit = evaluateAcceptance(
    [{ text: 'Attach evidence', check: { kind: 'artifact' } }],
    [],
    unreadable
  )
  expect(explicit[0].result).toBe('fail')
  expect(
    decideVerificationVerdict([], rules, { outcome: 'clear' }, true, unreadable, explicit)
  ).toEqual({ verdict: 'FAIL', reason: 'artifact_invalid' })
  const implicit = evaluateAcceptance(
    [{ text: 'Person judges', check: { kind: 'human' } }],
    [],
    unreadable
  )
  expect(
    decideVerificationVerdict([], rules, { outcome: 'clear' }, true, unreadable, implicit)
  ).toEqual({
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    detail: 'artifact_unreadable',
    escalation: 'human'
  })
})
it('keeps deterministic gates and failures ahead of human criteria', () => {
  const acceptance = evaluateAcceptance(
    [{ text: 'Human', check: { kind: 'human' } }],
    [],
    artifacts
  )
  expect(
    decideVerificationVerdict(
      [{ result: 'fail' }],
      rules,
      { outcome: 'clear' },
      false,
      artifacts,
      acceptance
    )
  ).toEqual({ verdict: 'FAIL', reason: 'checks_failed' })
  expect(
    decideVerificationVerdict(
      [],
      rules,
      { outcome: 'fail', reason: 'scope_violation' },
      false,
      artifacts,
      acceptance
    )
  ).toEqual({ verdict: 'FAIL', reason: 'scope_violation' })
})
it('redacts model text and commands before evidence and audits are written', () => {
  const token = `gh${'p_'}${'Z'.repeat(36)}`
  const acceptance = evaluateAcceptance(
    [{ text: `Check ${token}`, check: { kind: 'command', command: `node ${token}` } }],
    [],
    artifacts
  )
  expect(JSON.stringify(acceptance)).not.toContain(token)
  expect(acceptance[0].text).toContain('[REDACTED]')
})
