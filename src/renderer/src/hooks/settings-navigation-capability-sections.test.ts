import { describe, expect, it } from 'vitest'
import { buildSetupSettingsSections } from './settings-navigation-capability-sections'

describe('desktop setup settings with the shipped mobile availability', () => {
  it('omits the Mobile section', () => {
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
    expect(sections.map((section) => section.id)).toEqual([
      'orca-account',
      'setup-guide',
      'general',
      'integrations'
    ])
  })
})
