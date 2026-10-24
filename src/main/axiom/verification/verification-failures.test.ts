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
