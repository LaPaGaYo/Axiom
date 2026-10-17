// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n, setRendererUiLanguage } from '@/i18n/i18n'
import { TASK_STAGES } from '../../../../shared/axiom-contract/lifecycle'
import { TASK_STAGE_LABELS } from '../../../../shared/axiom-contract/stage-labels'
import { TaskStageBadge } from './TaskStageBadge'

const container = document.createElement('div')
const root = createRoot(container)
afterEach(() => act(() => root.render(null)))

describe('TaskStageBadge', () => {
  it.each(TASK_STAGES)('renders authoritative %s independently of settled execution', (stage) => {
    act(() => root.render(<TaskStageBadge stage={stage} orcaStatus="completed" />))
    expect(container.querySelector('[data-task-stage]')?.textContent).toBe(
      TASK_STAGE_LABELS[stage].en
    )
    expect(container.textContent).toContain('Execution projection: Attempt settled')
    expect(container.textContent).not.toMatch(/\bdone\b|completed/i)
    expect(container.querySelector('svg')).toBeNull()
  })
  it('uses Chinese stage and projection labels through i18n', async () => {
    await act(async () => {
      await setRendererUiLanguage('zh')
      root.render(<TaskStageBadge stage="SUBMITTED" orcaStatus="completed" />)
    })
    expect(container.textContent).toContain('已提交，待验证')
    expect(container.textContent).toContain('执行投影: 当前 Attempt 已结算')
    await act(async () => {
      await i18n.changeLanguage('en')
    })
  })
})
