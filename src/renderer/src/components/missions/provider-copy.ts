import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { ProviderEligibility } from './providers-draft'

export function providerLabel(provider: string) {
  return isTuiAgent(provider) ? getAgentLabel(provider) : provider
}

export function providerReasonGloss(reason: NonNullable<ProviderEligibility['planner']['reason']>) {
  switch (reason) {
    case 'not_installed':
      return translate(
        'missions.providerNotInstalled',
        'Not installed on this computer. The policy does not change this.'
      )
    case 'no_account':
      return translate(
        'missions.providerNoAccount',
        'No account is selected. Choose one in Settings › Accounts.'
      )
    case 'not_certified':
      return translate(
        'missions.providerNotCertified',
        'Not certified, or only provisional while this policy allows only certified combinations.'
      )
    case 'disallowed':
      return translate('missions.providerDisallowed', 'Not allowed by this policy.')
    case 'tier_too_low':
      return translate('missions.providerTierTooLow', 'Not certified for this role or risk level.')
    case 'account_cooldown':
      return translate(
        'missions.providerAccountCooldown',
        'The selected account is waiting after a usage limit. The policy does not change this.'
      )
  }
}

export function providerSlotCopy(slot: ProviderEligibility['planner']) {
  if (slot.eligible) {
    return { value: translate('missions.providersYes', 'Yes') }
  }
  return slot.reason
    ? { value: slot.reason, gloss: providerReasonGloss(slot.reason) }
    : { value: translate('missions.providersNo', 'No') }
}
