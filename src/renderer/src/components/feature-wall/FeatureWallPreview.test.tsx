// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_WALL_WORKFLOWS } from '../../../../shared/feature-wall-workflows'
import { PRODUCT_EGRESS_POLICY } from '../../../../shared/product-egress-policy'
import { RelatedFeatures } from './FeatureWallPreview'

const docsSiteOrigin = PRODUCT_EGRESS_POLICY.docsSiteOrigin

afterEach(() => {
  cleanup()
  Object.assign(PRODUCT_EGRESS_POLICY, { docsSiteOrigin })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('feature wall documentation links', () => {
  it('keeps related feature labels but disables navigation without a docs site', () => {
    const openUrl = vi.fn()
    vi.stubGlobal('window', { api: { shell: { openUrl } } })

    for (const workflow of FEATURE_WALL_WORKFLOWS) {
      render(<RelatedFeatures workflow={workflow} source="help_menu" />)
    }

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(6)
    for (const button of buttons) {
      expect(button.hasAttribute('disabled')).toBe(true)
      fireEvent.click(button)
    }
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('opens the policy docs site with the related tile path when configured', () => {
    const openUrl = vi.fn()
    vi.stubGlobal('window', { api: { shell: { openUrl } } })
    Object.assign(PRODUCT_EGRESS_POLICY, { docsSiteOrigin: 'https://docs.example.test' })
    const workflow = FEATURE_WALL_WORKFLOWS[0]
    render(<RelatedFeatures workflow={workflow} source="help_menu" />)

    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)

    expect(openUrl).toHaveBeenCalledWith('https://docs.example.test/docs/model/quick-open')
  })
})
