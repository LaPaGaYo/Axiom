import { expect, it } from 'vitest'
import { extractFailureNames } from './verification-failures'

it('extracts bounded vitest and jest failure names from captured output', () => {
  const vitest =
    '\u001b[31m FAIL \u001b[0m src/domain/recurrence.test.ts > advances daily, weekly, interval and clamped monthly dates\n FAIL  |unit| src/services/date-range.test.ts > dateRange accepts inclusive and optional boundaries\n FAIL  node src/example.test.ts > suite > case'
  expect(extractFailureNames(vitest)).toEqual([
    'src/domain/recurrence.test.ts > advances daily, weekly, interval and clamped monthly dates',
    'src/services/date-range.test.ts > dateRange accepts inclusive and optional boundaries',
    'src/example.test.ts > suite > case'
  ])
  expect(
    extractFailureNames(
      'FAIL src/a.test.ts (5.242 s)\n  ● suite › case\nAssertionError: wrong\n  ● suite › another'
    )
  ).toEqual(['src/a.test.ts > suite > case', 'src/a.test.ts > suite > another'])
  expect(extractFailureNames('Unknown runner failed')).toEqual([])
  const many = Array.from(
    { length: 25 },
    (_, i) => ` FAIL src/a.test.ts > ${i}${'x'.repeat(400)}`
  ).join('\n')
  expect(extractFailureNames(many)).toHaveLength(20)
  expect(extractFailureNames(many).every((name) => name.length <= 300)).toBe(true)
})

it('extracts fixture deterministic reporter failures from captured output', () => {
  const output = [
    '> flowtask@1.0.0 test:unit',
    "src/domain/recurrence.test.ts > advances daily, weekly, interval and clamped monthly dates: expected '2026-03-03' to be '2026-02-28' // Object.is equality",
    'src/services/date-range.test.ts > dateRange accepts inclusive and optional boundaries: expected false to be true',
    'src/a.test.ts > suite > case: boom',
    "src/b.test.ts: Cannot find module './x'",
    'Unhandled: oops',
    'Files: 3; tests: 12 passed, 3 failed, 0 skipped, 0 pending; run: failed'
  ].join('\n')
  expect(extractFailureNames(output)).toEqual([
    'src/domain/recurrence.test.ts > advances daily, weekly, interval and clamped monthly dates',
    'src/services/date-range.test.ts > dateRange accepts inclusive and optional boundaries',
    'src/a.test.ts > suite > case'
  ])
})

it('ignores module errors, unhandled errors, summaries, echoes and non-test paths', () => {
  const output = [
    "src/b.test.ts: Cannot find module './x'",
    'Unhandled: oops',
    'Files: 1; tests: 0 passed, 0 failed, 0 skipped, 0 pending; run: failed',
    '> flowtask@1.0.0 test:unit',
    'src/a.test.ts > case without a message separator',
    'src/a.ts > case: boom',
    'src/a.test.css > case: boom',
    'src/a.test.ts.map > case: boom',
    'src/has spaces.test.ts > case: boom',
    'prefix src/a.test.ts > case: boom'
  ].join('\n')
  expect(extractFailureNames(output)).toEqual([])
})

it.each(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'])(
  'recognises deterministic reporter test and spec paths with the %s extension',
  (extension) => {
    expect(
      extractFailureNames(
        `  src/a.test.${extension} > suite > case: boom\r\n\tsrc/b.spec.${extension} > case: boom`
      )
    ).toEqual([`src/a.test.${extension} > suite > case`, `src/b.spec.${extension} > case`])
  }
)

it('cuts deterministic reporter names at the first colon-space after the file separator', () => {
  expect(extractFailureNames('src/a.test.ts > suite > case: detail: boom')).toEqual([
    'src/a.test.ts > suite > case'
  ])
})

it('strips ANSI, de-duplicates and bounds deterministic reporter failure names', () => {
  const output = [
    '\u001b[31msrc/a.test.ts > case: boom\u001b[0m',
    'src/a.test.ts > case: another message',
    ' FAIL src/a.test.ts > case',
    ...Array.from({ length: 25 }, (_, i) => `src/a.test.ts > ${i}${'x'.repeat(400)}: boom`)
  ].join('\n')
  const failures = extractFailureNames(output)
  expect(failures[0]).toBe('src/a.test.ts > case')
  expect(failures.filter((name) => name === 'src/a.test.ts > case')).toHaveLength(1)
  expect(failures).toHaveLength(20)
  expect(failures.every((name) => name.length <= 300)).toBe(true)
})
