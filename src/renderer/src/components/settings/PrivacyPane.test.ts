import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { PrivacyPane } from './PrivacyPane'
import { getPrivacyPaneSearchEntries } from './privacy-search'

describe('PrivacyPane without product telemetry', () => {
  it.each([true, false, null])(
    'keeps diagnostics without consent UI when optedIn=%s',
    (optedIn) => {
      const settings = createGlobalSettingsFixture({
        telemetry: { installId: 'test-install-id', existedBeforeTelemetryRelease: true, optedIn }
      })
      const markup = renderToStaticMarkup(React.createElement(PrivacyPane, { settings }))
      expect(markup).toContain('Send app diagnostics to support')
      expect(markup).toContain('Create diagnostic file')
      expect(markup).not.toContain('Share anonymous usage data')
      expect(markup).not.toContain('role="switch"')
      expect(markup).not.toContain('Privacy policy')
      expect(markup).not.toContain('privacy-pane-blocked-helper')
    }
  )

  it('keeps diagnostics searchable and removes consent-section search entries', () => {
    const entries = getPrivacyPaneSearchEntries()
    expect(entries.some((entry) => entry.title === 'Diagnostics')).toBe(true)
    expect(entries.some((entry) => entry.title === 'Share Anonymous Usage Data')).toBe(false)
    expect(entries.some((entry) => entry.title === 'Telemetry environment variables')).toBe(false)
    expect(entries.flatMap((entry) => entry.keywords)).not.toContain('opt in')
    expect(entries.flatMap((entry) => entry.keywords)).not.toContain('opt out')
  })
})
