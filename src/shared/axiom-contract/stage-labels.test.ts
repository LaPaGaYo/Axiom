import { describe, expect, it } from 'vitest'
import { MISSION_STATUSES, TASK_STAGES } from './lifecycle'
import { MISSION_STATUS_LABELS, TASK_STAGE_LABELS, countTaskStages } from './stage-labels'

describe('authoritative lifecycle labels', () => {
  it.each(['en', 'zh'] as const)('gives every Task stage a distinct %s label', (locale) => {
    const labels = TASK_STAGES.map((stage) => TASK_STAGE_LABELS[stage][locale])
    expect(labels.every((label) => label.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(TASK_STAGES.length)
    expect(TASK_STAGE_LABELS.SUBMITTED[locale]).not.toBe(TASK_STAGE_LABELS.INTEGRATED[locale])
  })
  it.each(['en', 'zh'] as const)('labels every Mission status in %s', (locale) => {
    expect(MISSION_STATUSES.map((status) => MISSION_STATUS_LABELS[status][locale])).toEqual(
      expect.arrayContaining(MISSION_STATUSES.map(() => expect.any(String)))
    )
    expect(
      new Set(MISSION_STATUSES.map((status) => MISSION_STATUS_LABELS[status][locale])).size
    ).toBe(MISSION_STATUSES.length)
  })
  it('counts integrated work separately from submitted or canceled work', () => {
    const counts = countTaskStages([
      { stage: 'SUBMITTED' },
      { stage: 'INTEGRATED' },
      { stage: 'CANCELED' }
    ])
    expect(counts.INTEGRATED).toBe(1)
    expect(counts.SUBMITTED).toBe(1)
    expect(counts.READY).toBe(0)
  })
})
