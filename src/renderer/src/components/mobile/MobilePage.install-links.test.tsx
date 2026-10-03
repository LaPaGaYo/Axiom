// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => {
  const storeState = {
    closeMobilePage: vi.fn(),
    orcaProfileAuthStatus: { state: 'connected' },
    settings: { showMobileButton: true },
    updateSettings: vi.fn().mockResolvedValue(undefined),
    fetchOrcaProfileAuthStatus: vi.fn().mockResolvedValue(null)
  }
  return {
    useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() }
}))

vi.mock('./use-mobile-install-qr', () => ({ useMobileInstallQr: () => null }))
vi.mock('./use-mobile-page-escape', () => ({ useMobilePageEscape: vi.fn() }))
vi.mock('../settings/mobile-pairing-device-polling', () => ({
  useMobilePairingDevicePolling: vi.fn()
}))

vi.mock('./MobilePageContent', () => ({
  MobilePageContent: (props: { openAndroidInstallGuide: () => void }) => (
    <button type="button" onClick={props.openAndroidInstallGuide}>
      Open Android install guide
    </button>
  )
}))

import MobilePage from './MobilePage'
import { _resetPairedMobileDevicesCacheForTests } from './paired-mobile-devices'

describe('MobilePage install links', () => {
  beforeEach(() => {
    _resetPairedMobileDevicesCacheForTests()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          getPairingQR: vi.fn().mockResolvedValue({
            available: true,
            qrDataUrl: 'data:image/png;base64,qr',
            qrSize: 218,
            pairingUrl: 'orca://pair#automatic'
          }),
          listDevices: vi.fn().mockResolvedValue({ devices: [] }),
          listNetworkInterfaces: vi.fn().mockResolvedValue({ interfaces: [] })
        },
        shell: { openUrl: vi.fn() },
        ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) }
      }
    })
  })

  afterEach(cleanup)

  it('opens Android troubleshooting in the system browser', async () => {
    const user = userEvent.setup()
    render(<MobilePage />)

    await user.click(screen.getByRole('button', { name: 'Open Android install guide' }))

    expect(window.api.shell.openUrl).toHaveBeenCalledWith(
      'https://github.com/LaPaGaYo/Axiom#readme'
    )
  })
})
