import { describe, expect, it } from 'vitest'
import { SubmissionReportSchema } from './submission-params'

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
