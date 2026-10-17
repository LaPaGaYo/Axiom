import { describe, expect, it } from 'vitest'
import { isTopLevelView } from '../../../shared/top-level-view'

describe('Mission view persistence boundary', () => {
  it('accepts Missions as a top-level view', () => {
    expect(isTopLevelView('missions')).toBe(true)
  })
  it('preserves existing views and rejects invalid or inherited names', () => {
    expect(isTopLevelView('terminal')).toBe(true)
    expect(isTopLevelView('automations')).toBe(true)
    for (const invalid of ['constructor', '__proto__', 'unknown-view', null, 1]) {
      expect(isTopLevelView(invalid)).toBe(false)
    }
  })
})
