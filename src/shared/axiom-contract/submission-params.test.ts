import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HeadlessSubmissionReportSchema, SubmissionReportSchema } from './submission-params'

const report = {
  summary: 'Implemented the Task',
  filesChanged: ['src/file.ts'],
  checksRun: [{ command: 'pnpm test', result: 'pass', durationMs: 5 }],
  artifacts: ['art_report'],
  limitations: [],
  risks: [],
  questions: [],
  followUps: []
}
describe('Submission report contract', () => {
  it('caps each item list at 20 entries of 2,000 characters on both channels and in the preamble schema', () => {
    const { filesChanged: _filesChanged, ...headless } = { ...report, artifacts: [] }
    for (const field of ['questions', 'followUps']) {
      for (const [schema, base] of [
        [SubmissionReportSchema, report],
        [HeadlessSubmissionReportSchema, headless]
      ] as const) {
        expect(
          schema.safeParse({ ...base, [field]: Array(20).fill('x'.repeat(2000)) }).success
        ).toBe(true)
        expect(schema.safeParse({ ...base, [field]: Array(21).fill('Q') }).success).toBe(false)
        expect(schema.safeParse({ ...base, [field]: ['x'.repeat(2001)] }).success).toBe(false)
      }
      expect(z.toJSONSchema(HeadlessSubmissionReportSchema).properties?.[field]).toMatchObject({
        maxItems: 20,
        items: { maxLength: 2000 }
      })
    }
  })
  it('loads reports that omit the optional item lists', () => {
    const { questions: _questions, followUps: _followUps, ...legacy } = report
    expect(SubmissionReportSchema.parse(legacy)).toEqual(report)
  })
  it('accepts the full contract and a 4,000-character summary', () => {
    expect(SubmissionReportSchema.parse(report)).toEqual(report)
    expect(SubmissionReportSchema.safeParse({ ...report, summary: 'x'.repeat(4000) }).success).toBe(
      true
    )
  })
  it.each([
    { ...report, summary: ' ' },
    { ...report, summary: 'x'.repeat(4001) },
    { ...report, candidateId: 'worker-chosen' },
    { ...report, filesChanged: undefined },
    { ...report, checksRun: [{ command: 'test', result: 'PASS' }] },
    { ...report, checksRun: [{ command: 'test', result: 'pass', durationMs: -1 }] },
    { ...report, checksRun: [{ command: 'test', result: 'pass', extra: true }] }
  ])('rejects incomplete or untrusted report fields %#', (value) => {
    expect(SubmissionReportSchema.safeParse(value).success).toBe(false)
  })
})

describe('Headless outcome contract', () => {
  const { filesChanged: _filesChanged, ...headless } = { ...report, artifacts: [] }
  it.each([
    undefined,
    { outcome: 'submitted' },
    { outcome: 'no_change', reason: 'candidate_already_correct' },
    { outcome: 'no_change', reason: 'cannot_reproduce' },
    { outcome: 'blocked', reason: 'blocked_by_scope', paths: [' src/check.ts '] }
  ])('accepts the declared outcome %j without adding it to terminal reports', (outcome) => {
    const parsed = HeadlessSubmissionReportSchema.parse({ ...headless, outcome })
    expect(parsed.outcome).toEqual(
      outcome?.outcome === 'blocked' ? { ...outcome, paths: ['src/check.ts'] } : outcome
    )
    if (outcome) {
      expect(SubmissionReportSchema.safeParse({ ...report, outcome }).success).toBe(false)
    }
  })
  it.each([
    { outcome: 'submitted', reason: 'cannot_reproduce' },
    { outcome: 'no_change', reason: 'blocked_by_scope' },
    { outcome: 'no_change' },
    { outcome: 'blocked', reason: 'cannot_reproduce', paths: ['src/check.ts'] },
    { outcome: 'blocked', reason: 'blocked_by_scope', paths: [] },
    { outcome: 'blocked', reason: 'blocked_by_scope', paths: [' '] },
    { outcome: 'blocked', reason: 'blocked_by_scope', paths: ['x'.repeat(501)] },
    { outcome: 'blocked', reason: 'blocked_by_scope', paths: Array(51).fill('src/check.ts') },
    { outcome: 'blocked', reason: 'blocked_by_scope', paths: ['src/check.ts'], extra: true }
  ])('rejects invalid outcomes %j', (outcome) => {
    expect(HeadlessSubmissionReportSchema.safeParse({ ...headless, outcome }).success).toBe(false)
  })
})
