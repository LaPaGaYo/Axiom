import { expect, it } from 'vitest'
import { readVerdictRecord, VerdictRecordSchema } from './verdict-record'
import { verificationRun } from './contract-fixtures.test-support'

it('counts the entries of a record it could not read', () => {
  const clean = readVerdictRecord(verificationRun.verdictDetail)
  expect(clean).not.toHaveProperty('unreadable')
  const record = {
    checks: [...clean.checks, null, { index: 'invalid' }],
    acceptance: [...clean.acceptance, false],
    evidenceArtifactIds: ['valid', null],
    diff: {
      scopeViolations: ['src/a.ts', 12],
      dangerous: [{ path: 'p', pattern: 'p' }, null],
      secrets: [false],
      tampering: [{ path: 't', rule: 'skip', count: 1 }, {}],
      generated: [null],
      binary: ['file', 0],
      ignoredScopeEntries: [true]
    }
  }
  const parsed = readVerdictRecord(record)
  expect(parsed).toMatchObject({
    unreadable: 11,
    checks: clean.checks,
    acceptance: clean.acceptance
  })
  expect(parsed.diff?.dangerous).toEqual([{ path: 'p', pattern: 'p' }])
  expect(
    readVerdictRecord({
      checks: {},
      acceptance: 4,
      evidenceArtifactIds: null,
      diff: { binary: false }
    })
  ).not.toHaveProperty('unreadable')
  expect(
    readVerdictRecord({ checks: [{ ...clean.checks[0], failures: [null] }] })
  ).not.toHaveProperty('unreadable')
  for (const input of [undefined, null, false, [], 'record']) {
    expect(readVerdictRecord(input)).toEqual({
      checks: [],
      acceptance: [],
      evidenceArtifactIds: []
    })
  }
})

it('reads the disposition of a resolution and keeps a resolution with an unknown one', () => {
  const resolution = {
    verdict: 'PASS',
    rationale: 'Reviewed the evidence.',
    criteria: [1],
    by: 'user',
    at: 'time'
  }
  for (const disposition of ['fixed', 'rejected', 'intentional', 'not_worth']) {
    expect(readVerdictRecord({ resolution: { ...resolution, disposition } }).resolution).toEqual({
      ...resolution,
      disposition
    })
  }
  const unknown = readVerdictRecord({ resolution: { ...resolution, disposition: 'future_value' } })
  expect(unknown.resolution).toEqual(resolution)
  expect(unknown.resolution).not.toHaveProperty('disposition')
  expect(readVerdictRecord({ resolution }).resolution).toEqual(resolution)
})

it('reads a malformed or partial verdict record without failing', () => {
  const empty = { checks: [], acceptance: [], evidenceArtifactIds: [] }
  for (const value of [undefined, null, false, 42, 'verdict', [], {}]) {
    expect(readVerdictRecord(value)).toEqual(empty)
  }
  const good = { index: 3, source: 'evidence', command: 'node --version', result: 'pass' }
  const parsed = readVerdictRecord({
    phase: 4,
    verdict: 'DONE',
    reason: 'old_reason',
    checks: [good, { index: 'bad' }, { ...good, index: 7, excerpt: 'literal output', extra: true }],
    acceptance: [null],
    resolution: { verdict: 'PASS' },
    rerun: 'bad',
    diff: 'bad',
    evidenceArtifactIds: ['evidence-1', null, 42],
    unknown: 'ignored'
  })
  expect(parsed).toMatchObject({ reason: 'old_reason', evidenceArtifactIds: ['evidence-1'] })
  expect(parsed.phase).toBeUndefined()
  expect(parsed.verdict).toBeUndefined()
  expect(parsed.diff).toBeUndefined()
  expect(parsed.resolution).toBeUndefined()
  expect(parsed.rerun).toBeUndefined()
  expect(parsed.acceptance).toEqual([])
  expect(parsed.checks.map((check) => check.index)).toEqual([3, 7])
  expect(parsed.checks[1].excerpt).toBe('literal output')
  expect(parsed).not.toHaveProperty('unknown')
  expect(parsed.checks[1]).not.toHaveProperty('extra')
  expect(
    readVerdictRecord({ checks: 'not an array', acceptance: {}, evidenceArtifactIds: 12 })
  ).toEqual(empty)
  const view = readVerdictRecord({
    ...verificationRun.verdictDetail,
    resolution: {
      verdict: 'PASS',
      rationale: 'Reviewed',
      criteria: [1],
      by: 'user',
      at: 'time',
      extra: 1
    },
    rerun: { rationale: 'Changed criteria', by: 'user', at: 'time', extra: 1 },
    diff: {
      changedPaths: 3,
      scopeViolations: ['a', 2],
      secrets: [{ path: 'p', pattern: 'key', secret: 'discard' }],
      patchComplete: false,
      counts: { secrets: 70, binary: 'bad' },
      extra: 1
    }
  })
  expect(view.acceptance).toHaveLength(2)
  expect(view.resolution?.criteria).toEqual([1])
  expect(view.rerun?.rationale).toBe('Changed criteria')
  expect(view.diff?.scopeViolations).toEqual(['a'])
  expect(view.diff?.secrets).toEqual([{ path: 'p', pattern: 'key' }])
  expect(view.diff?.counts?.secrets).toBe(70)
  expect(VerdictRecordSchema.safeParse(view).success).toBe(true)
})
