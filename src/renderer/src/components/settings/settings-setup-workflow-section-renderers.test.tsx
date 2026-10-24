// @vitest-environment happy-dom

import { expect, it } from 'vitest'
import { deriveNeededSectionIds } from './settings-load-performance'
import {
  renderMobileSettingsSection,
  renderOrcaAccountSettingsSection
} from './settings-setup-workflow-section-renderers'

it('does not render Mobile with the shipped switch even when stale navigation needs it', () => {
  const neededSectionIds = deriveNeededSectionIds({
    navSectionIds: ['general'],
    mountedSectionIds: new Set(['mobile']),
    activeSectionId: 'mobile',
    pendingSectionId: 'mobile',
    query: '',
    visibleSectionIds: new Set(['general'])
  })
  expect(neededSectionIds.has('mobile')).toBe(true)

  const context = {
    model: { showDesktopOnlySettings: true },
    navigation: { getSectionSearchEntries: () => [] },
    view: { isSectionMounted: (id: string) => neededSectionIds.has(id) }
  }

  expect(renderMobileSettingsSection(context)).toBeNull()
})

it.each(['active', 'pending'] as const)(
  'does not render Axiom Account with the shipped switch even with a stale %s target',
  (target) => {
    const neededSectionIds = deriveNeededSectionIds({
      navSectionIds: ['general'],
      mountedSectionIds: new Set(),
      activeSectionId: target === 'active' ? 'orca-account' : 'general',
      pendingSectionId: target === 'pending' ? 'orca-account' : null,
      query: '',
      visibleSectionIds: new Set(['general'])
    })
    expect(neededSectionIds.has('orca-account')).toBe(true)

    const context = {
      model: { showDesktopOnlySettings: true },
      navigation: { getSectionSearchEntries: () => [] },
      view: { isSectionMounted: (id: string) => neededSectionIds.has(id) }
    }

    expect(renderOrcaAccountSettingsSection(context)).toBeNull()
  }
)
