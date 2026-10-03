import type { Platform } from './MobileHero'
import { translate } from '@/i18n/i18n'

// iOS ships two App Store tracks: the public App Store build (slower, ~weekly)
// and the TestFlight preview build (daily). Axiom has no Android download.
export type IosChannel = 'stable' | 'preview'

export type InstallCopy = { ctaLabel: string; url: string }

const IOS_CHANNEL_COPY: Record<IosChannel, InstallCopy> = {
  stable: {
    ctaLabel: 'Open App Store',
    url: 'https://apps.apple.com/app/orca-ide/id6766130217'
  },
  preview: {
    ctaLabel: 'Open TestFlight',
    url: 'https://testflight.apple.com/join/YjeGMQBA'
  }
}

export function getInstallCopy(platform: Platform, iosChannel: IosChannel): InstallCopy | null {
  return platform === 'ios' ? IOS_CHANNEL_COPY[iosChannel] : null
}

export function getChannelTagline(iosChannel: IosChannel): string {
  return iosChannel === 'preview'
    ? translate(
        'auto.components.mobile.mobile.platform.copy.preview.tagline',
        'Newest features, updated daily.'
      )
    : translate(
        'auto.components.mobile.mobile.platform.copy.stable.tagline',
        'The public release, updated weekly.'
      )
}
