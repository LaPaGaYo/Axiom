import { describe, expect, it } from 'vitest'
import { isTopLevelView } from '../top-level-view'
import { TopLevelViewSchema } from './client-ui-params'

describe('TopLevelViewSchema', () => {
  it('keeps its options aligned with the top-level view lookup', () => {
    expect(TopLevelViewSchema.options).toContain('missions')
    for (const view of TopLevelViewSchema.options) {
      expect(isTopLevelView(view)).toBe(true)
    }
    expect(TopLevelViewSchema.options).not.toContain('not-a-view')
    expect(isTopLevelView('not-a-view')).toBe(false)
  })
})
