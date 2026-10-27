/** Fixed T01 output for fixture-v1's four allowed paths, verified by the fixture's own gates. */
export const AXIOM_T01_FIXTURE_FILES = {
  'src/domain/sprint.ts': `export interface Sprint {
  id: string
  name: string
  startDate: string
  endDate: string
  state: 'open' | 'closed'
}
`,
  'src/domain/sprint.test.ts': `import { expect, test } from 'vitest'
import type { Sprint } from './sprint.js'
test('sprint preserves inclusive UTC boundaries and open or closed state', () => {
  const sprint: Sprint = { id: 's1', name: 'First', startDate: '2024-02-29', endDate: '2024-02-29', state: 'open' }
  expect(sprint.startDate).toBe(sprint.endDate)
  const closed: Sprint = { ...sprint, state: 'closed' }
  expect(closed.state).toBe('closed')
})
`,
  'src/domain/validate-sprint.ts': `import { isDate } from './date.js'
import { fail, ok, type Result } from './result.js'
import type { Sprint } from './sprint.js'
export function validateSprint(value: unknown): Result<Sprint> {
  if (typeof value !== 'object' || value === null) return fail('validation', 'Sprint must be an object')
  const sprint = value as Record<string, unknown>
  if (typeof sprint.id !== 'string' || !sprint.id.trim()) return fail('validation', 'Sprint id is required')
  if (typeof sprint.name !== 'string' || !sprint.name.trim()) return fail('validation', 'Sprint name is required')
  if (!isDate(sprint.startDate) || !isDate(sprint.endDate) || sprint.startDate > sprint.endDate) return fail('validation', 'Sprint dates must be ordered UTC dates')
  if (sprint.state !== 'open' && sprint.state !== 'closed') return fail('validation', 'Sprint state must be open or closed')
  return ok({ id: sprint.id, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, state: sprint.state })
}
`,
  'src/domain/validate-sprint.test.ts': `import { expect, test } from 'vitest'
import { validateSprint } from './validate-sprint.js'
const sprint = { id: 's1', name: 'First', startDate: '2024-02-29', endDate: '2024-03-01', state: 'open' }
test('validates inclusive UTC boundaries and both sprint states', () => {
  expect(validateSprint(sprint)).toEqual({ ok: true, value: sprint })
  expect(validateSprint({ ...sprint, endDate: sprint.startDate, state: 'closed' }).ok).toBe(true)
})
test('rejects absent identity, invalid dates, inverted boundaries and invalid states', () => {
  for (const value of [null, {}, { ...sprint, id: '' }, { ...sprint, name: '  ' }, { ...sprint, startDate: '2025-02-29' }, { ...sprint, endDate: '2024-02-28' }, { ...sprint, endDate: '2024-03-01T00:00:00Z' }, { ...sprint, state: 'done' }]) {
    const result = validateSprint(value)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation')
  }
})
`
}
