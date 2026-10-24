import { describe, expect, it } from 'vitest'
import { buildSetupSettingsSections } from './settings-navigation-capability-sections'

describe('desktop setup settings with the shipped mobile and cloud account availability', () => {
  it('omits the Mobile and Axiom Account sections', () => {
    const sections = buildSetupSettingsSections({
      isMac: false,
      isWindows: false,
      isLocalWindowsHost: false,
      isWindowsTerminalHost: false,
      isWebClient: false,
      nativeChatEnabled: false,
      hostQueuesMessages: false,
      managedBrowserCreationEnabled: true,
      mobileEmulatorCreationEnabled: true,
      isDev: false,
      isLinearConnected: false,
      repos: []
    })

    expect(sections.some((section) => section.id === 'mobile')).toBe(false)
    expect(sections.some((section) => section.id === 'orca-account')).toBe(false)
    expect(sections.map((section) => section.id)).toEqual([
      'setup-guide',
      'general',
      'integrations'
    ])
  })
})
